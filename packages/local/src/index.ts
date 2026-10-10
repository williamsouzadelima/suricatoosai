#!/usr/bin/env node

/**
 * Suricatoos Local Sandbox Client
 *
 * Connects to Suricatoos backend via Convex for connection lifecycle
 * and uses Centrifugo for real-time command relay and streaming output.
 *
 * Runs commands directly on the host OS (no Docker isolation).
 *
 * Usage:
 *   npx @suricatoos/local --token TOKEN
 */

import { ConvexHttpClient } from "convex/browser";
import { Centrifuge, Subscription, PublicationContext } from "centrifuge";
import WebSocket from "ws";
import { spawn, ChildProcess } from "child_process";
import os from "os";
import path from "node:path";
import { rm } from "node:fs/promises";
import {
  truncateOutput,
  MAX_OUTPUT_SIZE,
  getDefaultShell,
  buildShellSpawn,
} from "./utils";
import {
  ProcessRunner,
  ProcessRunOptions,
  ProcessRunResult,
  isPtyAvailable,
} from "./process-runner";
import {
  confirmProcessTermination,
  isProcessTreeTerminationConfirmed,
} from "./command-cancellation";
import { CentrifugoPublishQueue } from "./centrifugo-transport";
import { buildCentrifugoTransportConfig } from "./centrifugo-endpoints";

const DEFAULT_SHELL = getDefaultShell(os.platform());

// Idle auto-termination is DISABLED by default: a connector stays active until
// it is revoked from the Remote Control panel (revocation now also makes it
// self-remove). Opt back in with `--idle-timeout <minutes>` to reclaim a
// forgotten connector. 0 (the default) = never auto-terminate.
const DEFAULT_IDLE_TIMEOUT_MS = 0;

// Idle check interval: check every 5 minutes (only armed when a timeout is set)
const IDLE_CHECK_INTERVAL_MS = 5 * 60 * 1000;

// Agent version — KEEP IN SYNC with packages/local/package.json "version".
// Reported to the server so the Remote Control UI can flag "update available".
const AGENT_VERSION = "0.1.5";

// How often the agent polls the server for a pending update (Update button).
const UPDATE_POLL_INTERVAL_MS = 20 * 1000; // 20s

// Production Convex URL - hardcoded for the published package
const PRODUCTION_CONVEX_URL = "https://dutiful-sheep-343.convex.cloud";

// Convex function references (string paths work at runtime)
const api = {
  localSandbox: {
    connect: "localSandbox:connect" as const,
    disconnect: "localSandbox:disconnect" as const,
    refreshCentrifugoToken: "localSandbox:refreshCentrifugoToken" as const,
    pollAgentUpdate: "localSandbox:pollAgentUpdate" as const,
  },
};

// ANSI color codes for terminal output
const chalk = {
  blue: (s: string) => `\x1b[34m${s}\x1b[0m`,
  green: (s: string) => `\x1b[32m${s}\x1b[0m`,
  red: (s: string) => `\x1b[31m${s}\x1b[0m`,
  yellow: (s: string) => `\x1b[33m${s}\x1b[0m`,
  cyan: (s: string) => `\x1b[36m${s}\x1b[0m`,
  gray: (s: string) => `\x1b[90m${s}\x1b[0m`,
  bold: (s: string) => `\x1b[1m${s}\x1b[0m`,
};

export interface Config {
  convexUrl: string;
  token: string;
  name: string;
  // 0 = persistent (never auto-terminate); >0 = auto-terminate after this many
  // ms with no commands. Set via --idle-timeout <minutes>. Default 0.
  idleTimeoutMs: number;
}

interface OsInfo {
  platform: string;
  arch: string;
  release: string;
  hostname: string;
}

interface ClientCapabilities {
  commands: boolean;
  pty: boolean;
}

interface CentrifugoCommandMessage {
  type: "command";
  commandId: string;
  command: string;
  env?: Record<string, string>;
  cwd?: string;
  timeout?: number;
  background?: boolean;
  displayName?: string;
  targetConnectionId: string;
}

interface CentrifugoCommandCancelMessage {
  type: "command_cancel";
  commandId: string;
  targetConnectionId: string;
}

interface CentrifugoStdoutMessage {
  type: "stdout";
  commandId: string;
  data: string;
}

interface CentrifugoStderrMessage {
  type: "stderr";
  commandId: string;
  data: string;
}

interface CentrifugoExitMessage {
  type: "exit";
  commandId: string;
  exitCode: number;
  pid?: number;
}

interface CentrifugoErrorMessage {
  type: "error";
  commandId: string;
  message: string;
}

interface CentrifugoCommandCancelResultMessage {
  type: "command_cancel_result";
  commandId: string;
  canceled: boolean;
}

// --- PTY incoming message types ---

interface PtyCreateMessage {
  type: "pty_create";
  sessionId: string;
  command: string;
  cols?: number;
  rows?: number;
  cwd?: string;
  env?: Record<string, string>;
  targetConnectionId: string;
}

interface PtyInputMessage {
  type: "pty_input";
  sessionId: string;
  data: string;
  targetConnectionId: string;
}

interface PtyResizeMessage {
  type: "pty_resize";
  sessionId: string;
  cols: number;
  rows: number;
  targetConnectionId: string;
}

interface PtyKillMessage {
  type: "pty_kill";
  sessionId: string;
  signal?: string;
  targetConnectionId: string;
}

type CentrifugoPtyIncomingMessage =
  PtyCreateMessage | PtyInputMessage | PtyResizeMessage | PtyKillMessage;

type TargetedIncomingMessage =
  | CentrifugoCommandMessage
  | CentrifugoCommandCancelMessage
  | CentrifugoPtyIncomingMessage;

function isTargetedIncomingMessage(
  message: unknown,
): message is TargetedIncomingMessage {
  if (typeof message !== "object" || message === null) {
    return false;
  }
  const { type, targetConnectionId } = message as {
    type?: unknown;
    targetConnectionId?: unknown;
  };
  return (
    typeof targetConnectionId === "string" &&
    (type === "command" ||
      type === "command_cancel" ||
      type === "pty_create" ||
      type === "pty_input" ||
      type === "pty_resize" ||
      type === "pty_kill")
  );
}

// --- PTY outgoing message types ---

interface CentrifugoPtyReadyMessage {
  type: "pty_ready";
  sessionId: string;
  pid: number;
}

interface CentrifugoPtyDataMessage {
  type: "pty_data";
  sessionId: string;
  data: string;
}

interface CentrifugoPtyExitMessage {
  type: "pty_exit";
  sessionId: string;
  exitCode: number;
}

interface CentrifugoPtyErrorMessage {
  type: "pty_error";
  sessionId: string;
  message: string;
}

type CentrifugoOutgoingMessage =
  | CentrifugoStdoutMessage
  | CentrifugoStderrMessage
  | CentrifugoExitMessage
  | CentrifugoErrorMessage
  | CentrifugoCommandCancelResultMessage
  | CentrifugoPtyReadyMessage
  | CentrifugoPtyDataMessage
  | CentrifugoPtyExitMessage
  | CentrifugoPtyErrorMessage;

interface ConnectResult {
  success: boolean;
  userId?: string;
  connectionId?: string;
  centrifugoToken?: string;
  centrifugoWsUrl?: string;
  error?: string;
}

type RefreshTokenResult =
  | { ok: true; centrifugoToken: string }
  | {
      ok: false;
      terminated: true;
      reason:
        "connection_not_found" | "ownership_mismatch" | "connection_inactive";
      connectionId: string;
      clientVersion: string | null;
      status: string | null;
      disconnectReason:
        | "client_disconnect"
        | "desktop_disconnect"
        | "desktop_kicked_by_new_session"
        | "token_regenerated"
        | "presence_sweep"
        | "command_unresponsive"
        | "user_revoked"
        | null;
      msSinceDisconnected: number | null;
      msSinceLastHeartbeat: number | null;
      msSinceCreated: number | null;
    };

// "Invalid token" UNAUTHORIZED still throws server-side (the caller's token
// is bad, not a connection lifecycle event), so the catch path needs to
// recognize it as another terminate-the-loop signal.
function isInvalidTokenError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const data = (error as { data?: unknown }).data;
  if (!data || typeof data !== "object") return false;
  return (data as { code?: string }).code === "UNAUTHORIZED";
}

type LocalSandboxClientOptions = {
  onExitRequested?: (code: number, error: Error) => void;
};

export class LocalSandboxClient {
  private convexHttp: ConvexHttpClient;
  private centrifuge?: Centrifuge;
  private subscription?: Subscription;
  private userId?: string;
  private connectionId?: string;
  private isShuttingDown = false;
  private lastActivityTime: number;
  private idleCheckInterval?: NodeJS.Timeout;
  private updatePollInterval?: NodeJS.Timeout;
  private isUpdating = false;
  private processRunner: ProcessRunner;
  private activeStreamCommands: Map<string, ChildProcess> = new Map();
  private publishQueue?: CentrifugoPublishQueue;
  private cleanupPromise?: Promise<void>;
  private exitRequested = false;
  private revoking = false;
  private relayTransport: string | null = null;

  constructor(
    private config: Config,
    private readonly options: LocalSandboxClientOptions = {},
  ) {
    this.convexHttp = new ConvexHttpClient(config.convexUrl);
    this.lastActivityTime = Date.now();
    this.processRunner = new ProcessRunner();
    this.setupProcessRunnerListeners();
  }

  private requestExit(code: number, error: Error): void {
    if (this.exitRequested || this.isShuttingDown) return;
    this.exitRequested = true;
    void this.cleanup().then(
      () => {
        if (this.options.onExitRequested) {
          this.options.onExitRequested(code, error);
        } else {
          process.exit(code);
        }
      },
      (cleanupError) => {
        const fatal =
          cleanupError instanceof Error
            ? cleanupError
            : new Error(String(cleanupError));
        if (this.options.onExitRequested) {
          this.options.onExitRequested(code, fatal);
        } else {
          process.exit(code);
        }
      },
    );
  }

  private setupProcessRunnerListeners(): void {
    this.processRunner.on("data", (sessionId: string, data: string) => {
      this.publishToChannel({
        type: "pty_data",
        sessionId,
        data,
      }).catch((err: unknown) => {
        console.error(
          chalk.red(
            `[PTY] Failed to publish data for ${sessionId}: ${err instanceof Error ? err.message : String(err)}`,
          ),
        );
      });
    });

    this.processRunner.on("exit", (sessionId: string, exitCode: number) => {
      console.log(
        chalk.gray(`[PTY] Session ${sessionId} exited (code ${exitCode})`),
      );
      this.publishToChannel({
        type: "pty_exit",
        sessionId,
        exitCode,
      }).catch((err: unknown) => {
        console.error(
          chalk.red(
            `[PTY] Failed to publish exit for ${sessionId}: ${err instanceof Error ? err.message : String(err)}`,
          ),
        );
      });
    });

    this.processRunner.on("error", (sessionId: string, error: Error) => {
      console.error(
        chalk.red(`[PTY] Session ${sessionId} error: ${error.message}`),
      );
      this.publishToChannel({
        type: "pty_error",
        sessionId,
        message: error.message,
      }).catch((err: unknown) => {
        console.error(
          chalk.red(
            `[PTY] Failed to publish error for ${sessionId}: ${err instanceof Error ? err.message : String(err)}`,
          ),
        );
      });
    });
  }

  async start(): Promise<void> {
    console.log(chalk.blue("🚀 Starting Suricatoos local sandbox..."));
    console.log(
      chalk.yellow(
        "⚠️  Commands run directly on your OS without any isolation.",
      ),
    );
    await this.connect();
  }

  private getOsInfo(): OsInfo {
    return {
      platform: os.platform(),
      arch: os.arch(),
      release: os.release(),
      hostname: os.hostname(),
    };
  }

  private getCapabilities(): ClientCapabilities {
    return {
      commands: true,
      pty: isPtyAvailable(),
    };
  }

  private async connect(): Promise<void> {
    console.log(chalk.blue("Connecting to Suricatoos..."));

    try {
      const result = (await this.convexHttp.mutation(
        api.localSandbox.connect as never,
        {
          token: this.config.token,
          connectionName: this.config.name,
          clientVersion: AGENT_VERSION,
          osInfo: this.getOsInfo(),
          capabilities: this.getCapabilities(),
        } as never,
      )) as ConnectResult;

      // Revoked connector trying to (re)connect — e.g. a manual `npx` re-run, or
      // a systemd service relaunching after exit. Self-remove instead of
      // erroring in a loop, so nothing is left running or on disk.
      if (!result.success && result.error && /revoked/i.test(result.error)) {
        console.error(chalk.yellow(result.error));
        await this.handleRevoked();
        return;
      }

      if (
        !result.success ||
        !result.centrifugoToken ||
        !result.centrifugoWsUrl
      ) {
        throw new Error(result.error || "Authentication failed");
      }

      this.userId = result.userId;
      this.connectionId = result.connectionId;

      console.log(chalk.green("✓ Authenticated"));
      console.log(chalk.blue("Connecting to command relay..."));

      await this.setupCentrifugo(
        result.centrifugoWsUrl,
        result.centrifugoToken,
      );
      console.log(
        chalk.green(
          `✓ Connected to command relay (${this.relayTransport ?? "unknown transport"})`,
        ),
      );
      console.log(chalk.bold(chalk.green("🎉 Local sandbox is ready!")));
      console.log(chalk.gray(`Connection: ${this.connectionId}`));
      this.startIdleCheck();
      this.startUpdatePoll();
    } catch (error: unknown) {
      const err = error as { data?: { message?: string }; message?: string };
      const errorMessage =
        err?.data?.message || err?.message || JSON.stringify(error);
      console.error(chalk.red("❌ Connection failed:"), errorMessage);
      if (
        errorMessage.includes("Invalid token") ||
        errorMessage.includes("token")
      ) {
        console.error(chalk.yellow("Please regenerate your token in Settings"));
      }
      await this.cleanup().catch((cleanupError: unknown) => {
        const detail =
          cleanupError instanceof Error
            ? cleanupError.message
            : String(cleanupError);
        console.warn(chalk.yellow(`⚠️  Cleanup incomplete: ${detail}`));
      });
      throw error;
    }
  }

  private async setupCentrifugo(
    wsUrl: string,
    initialToken: string,
  ): Promise<void> {
    const transportConfig = buildCentrifugoTransportConfig(wsUrl);
    this.centrifuge = new Centrifuge(transportConfig.endpoints, {
      websocket: WebSocket as unknown as typeof globalThis.WebSocket,
      emulationEndpoint: transportConfig.emulationEndpoint,
      token: initialToken,
      getToken: async (): Promise<string> => {
        if (!this.connectionId) {
          throw new Error("Cannot refresh token: connectionId is null");
        }
        let result: RefreshTokenResult;
        try {
          result = (await this.convexHttp.mutation(
            api.localSandbox.refreshCentrifugoToken as never,
            {
              token: this.config.token,
              connectionId: this.connectionId,
            } as never,
          )) as RefreshTokenResult;
        } catch (error) {
          if (isInvalidTokenError(error)) {
            console.error(chalk.red("\n❌ Token rejected by server."));
            console.error(
              chalk.yellow("Please regenerate your token in Settings."),
            );
            // cleanup() synchronously calls centrifuge.disconnect() before any
            // awaits, so by the time we re-throw below Centrifuge is in a
            // terminal state and won't invoke getToken again.
            this.requestExit(1, new Error("Centrifugo token was rejected"));
          } else {
            console.error(
              chalk.red("Failed to refresh Centrifugo token:"),
              error,
            );
          }
          throw error;
        }
        if (result.ok) return result.centrifugoToken;

        // Revoked from the panel: self-remove and exit 0 rather than the generic
        // exit(1) below (which would crash-loop under a Restart=always
        // supervisor into a connect() the server now rejects). This is the
        // fallback path; the 20s poll usually catches revocation first.
        if (result.disconnectReason === "user_revoked") {
          void this.handleRevoked();
          throw new Error("connector revoked");
        }

        console.error(
          chalk.red(`\n❌ Connection terminated by server (${result.reason})`),
        );
        const reasonHint =
          result.disconnectReason === "token_regenerated"
            ? "Your token was regenerated; rerun with the new token."
            : result.disconnectReason === "presence_sweep"
              ? "Server presence sweep marked this connection stale."
              : result.disconnectReason === "command_unresponsive"
                ? "Server stopped this connection after repeated commands received no response. Restart Suricatoos Local and try again."
                : result.disconnectReason === "desktop_kicked_by_new_session"
                  ? "A new desktop session took over."
                  : result.disconnectReason === "client_disconnect" ||
                      result.disconnectReason === "desktop_disconnect"
                    ? "This connection was explicitly disconnected."
                    : "Likely causes: token regenerated, or disconnected from another session.";
        console.error(chalk.yellow(reasonHint));
        console.error(
          chalk.gray(
            JSON.stringify({
              connectionId: result.connectionId,
              disconnectReason: result.disconnectReason,
              msSinceDisconnected: result.msSinceDisconnected,
              msSinceLastHeartbeat: result.msSinceLastHeartbeat,
              msSinceCreated: result.msSinceCreated,
            }),
          ),
        );
        // Stop the Centrifuge retry loop and exit. cleanup() synchronously
        // calls centrifuge.disconnect() before any awaits, so by the time we
        // throw below Centrifuge is in a terminal state and won't invoke
        // getToken again.
        this.requestExit(
          1,
          new Error(`Centrifugo refresh aborted: ${result.reason}`),
        );
        throw new Error(`Centrifugo refresh aborted: ${result.reason}`);
      },
    });

    const channel = `sandbox:connection:${this.connectionId}#${this.userId}`;
    this.subscription = this.centrifuge.newSubscription(channel);
    this.publishQueue = new CentrifugoPublishQueue(async (message) => {
      if (!this.subscription) {
        throw new Error("Cannot publish: no active subscription");
      }
      await this.subscription.publish(message);
    });

    this.subscription.on("publication", (ctx: PublicationContext) => {
      if (this.isShuttingDown) return;

      const message = ctx.data;

      if (!isTargetedIncomingMessage(message)) {
        return;
      }

      if (message.targetConnectionId !== this.connectionId) {
        return;
      }

      this.lastActivityTime = Date.now();

      switch (message.type) {
        case "command":
          this.handleCommand(message as CentrifugoCommandMessage).catch(
            (error: unknown) => {
              const errorMsg =
                error instanceof Error ? error.message : JSON.stringify(error);
              console.error(chalk.red(`Error handling command: ${errorMsg}`));
            },
          );
          break;

        case "command_cancel":
          this.handleCommandCancel(
            message as CentrifugoCommandCancelMessage,
          ).catch((error: unknown) => {
            console.error(
              chalk.red(
                `[CMD] Failed to handle cancellation: ${error instanceof Error ? error.message : String(error)}`,
              ),
            );
          });
          break;

        case "pty_create":
          this.handlePtyCreate(message as PtyCreateMessage).catch(
            (error: unknown) => {
              const errorMsg =
                error instanceof Error ? error.message : String(error);
              console.error(
                chalk.red(`[PTY] Error creating session: ${errorMsg}`),
              );
            },
          );
          break;

        case "pty_input":
          this.handlePtyInput(message as PtyInputMessage);
          break;

        case "pty_resize":
          this.handlePtyResize(message as PtyResizeMessage);
          break;

        case "pty_kill":
          this.handlePtyKill(message as PtyKillMessage);
          break;

        default:
          break;
      }
    });

    this.centrifuge.on("disconnected", (ctx) => {
      if (!this.isShuttingDown) {
        const isConnectionLimit =
          ctx.reason?.includes("connection limit") || ctx.code === 4503;
        if (isConnectionLimit) {
          console.error(
            chalk.red(
              "❌ Connection limit reached. The server has too many active connections.",
            ),
          );
          console.error(
            chalk.yellow("Please try again later or contact support."),
          );
          this.requestExit(1, new Error("Centrifugo connection limit reached"));
        } else {
          // Any non-shutdown, non-4503 "disconnected" event means the Centrifuge
          // client has stopped for good: terminal disconnect codes (e.g. 3501
          // "bad request") are non-reconnectable, so the SDK will NOT retry on
          // its own. Previously this branch only logged, leaving the process
          // "alive but dead" (connected=false forever) and never triggering the
          // systemd Restart=always. Exit(1) so the service manager restarts us
          // with a fresh connection + subscription.
          console.log(
            chalk.yellow(
              `⚠️  Disconnected from Centrifugo: ${ctx.reason}. Exiting so the service manager can reconnect.`,
            ),
          );
          this.requestExit(
            1,
            new Error(
              `Disconnected from Centrifugo: ${ctx.reason ?? "unknown"}`,
            ),
          );
        }
      }
    });

    this.centrifuge.on("connected", (ctx) => {
      this.relayTransport = ctx.transport;
    });

    const ready = new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error("Timed out connecting to the command relay"));
      }, 20_000);
      const finish = (error?: Error) => {
        clearTimeout(timeout);
        if (error) reject(error);
        else resolve();
      };
      this.subscription?.once("subscribed", () => finish());
      this.subscription?.on("error", (ctx) => {
        console.warn(
          chalk.yellow(
            `Command relay subscription error; retrying: ${ctx.error?.message ?? "unknown"}`,
          ),
        );
      });
    });

    this.subscription.subscribe();
    this.centrifuge.connect();
    await ready;
  }

  private async publishToChannel(
    data: CentrifugoOutgoingMessage,
  ): Promise<void> {
    if (!this.publishQueue) {
      console.error(chalk.red("Cannot publish: no active subscription"));
      return;
    }
    try {
      await this.publishQueue.publish(
        data as unknown as Record<string, unknown>,
      );
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : JSON.stringify(err);
      console.error(chalk.red(`Publish failed: ${msg}`));
      throw err;
    }
  }

  private async handleCommand(msg: CentrifugoCommandMessage): Promise<void> {
    const { commandId, command, env, cwd, timeout, background, displayName } =
      msg;

    // Determine what to show in console:
    // - displayName === "" (empty string): hide command entirely
    // - displayName === "something": show that instead of command
    // - displayName === undefined: show actual command
    const shouldShow = displayName !== "";
    const displayText = displayName || command;
    if (shouldShow) {
      console.log(chalk.cyan(`▶ ${background ? "[BG] " : ""}${displayText}`));
    }

    try {
      let fullCommand = command;

      // Detect whether the default shell is cmd.exe so we emit the
      // correct syntax for cd and environment variable injection.
      const shellBase =
        DEFAULT_SHELL.shell
          .toLowerCase()
          .replace(/\\/g, "/")
          .split("/")
          .pop() ?? "";
      const useCmd = shellBase === "cmd" || shellBase === "cmd.exe";

      if (cwd && cwd.trim() !== "") {
        fullCommand = useCmd
          ? `cd /d "${cwd}" && ${fullCommand}`
          : `cd "${cwd}" 2>/dev/null && ${fullCommand}`;
      }

      if (env) {
        const envString = Object.entries(env)
          .map(([k, v]) => {
            if (useCmd) {
              // cmd.exe: use `set` with no trailing space inside quotes
              const escaped = v.replace(/%/g, "%%").replace(/"/g, '""');
              return `set "${k}=${escaped}"`;
            }
            const escaped = v
              .replace(/\\/g, "\\\\")
              .replace(/"/g, '\\"')
              .replace(/\$/g, "\\$")
              .replace(/`/g, "\\`");
            return `export ${k}="${escaped}"`;
          })
          .join(useCmd ? " && " : "; ");
        fullCommand = useCmd
          ? `${envString} && ${fullCommand}`
          : `${envString}; ${fullCommand}`;
      }

      if (background) {
        const pid = await this.spawnBackground(fullCommand);
        await this.publishToChannel({
          type: "exit",
          commandId,
          exitCode: 0,
          pid,
        });
        console.log(
          chalk.green(`✓ Background process started with PID: ${pid}`),
        );
        return;
      }

      await this.streamCommand(
        commandId,
        fullCommand,
        timeout,
        shouldShow,
        displayText,
      );
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      await this.publishToChannel({
        type: "error",
        commandId,
        message: truncateOutput(message),
      });
      console.log(chalk.red(`✗ ${displayText}: ${message}`));
    }
  }

  private async handleCommandCancel(
    msg: CentrifugoCommandCancelMessage,
  ): Promise<void> {
    const proc = this.activeStreamCommands.get(msg.commandId);
    const canceled = proc
      ? await confirmProcessTermination(
          proc,
          () => this.terminateProcessTree(proc),
          undefined,
          () => isProcessTreeTerminationConfirmed(proc),
        )
      : true;
    await this.publishToChannel({
      type: "command_cancel_result",
      commandId: msg.commandId,
      canceled,
    });
  }

  private terminateProcessTree(proc: ChildProcess): void {
    const pid = proc.pid;
    if (!pid) {
      proc.kill("SIGKILL");
      return;
    }

    if (os.platform() === "win32") {
      spawn("taskkill", ["/PID", String(pid), "/T", "/F"], {
        stdio: "ignore",
        windowsHide: true,
      });
      return;
    }

    try {
      process.kill(-pid, "SIGTERM");
    } catch {
      proc.kill("SIGTERM");
    }

    setTimeout(() => {
      if (isProcessTreeTerminationConfirmed(proc)) {
        return;
      }
      try {
        process.kill(-pid, "SIGKILL");
      } catch {
        proc.kill("SIGKILL");
      }
    }, 1000).unref();
  }

  private async terminateActiveStreamCommands(): Promise<void> {
    const commands = [...this.activeStreamCommands.entries()];
    const results = await Promise.all(
      commands.map(async ([commandId, proc]) => {
        console.log(
          chalk.yellow(`[CMD] Terminating active command ${commandId}`),
        );
        const confirmed = await confirmProcessTermination(
          proc,
          () => this.terminateProcessTree(proc),
          undefined,
          () => isProcessTreeTerminationConfirmed(proc),
        );
        if (confirmed) this.activeStreamCommands.delete(commandId);
        return confirmed;
      }),
    );
    const unconfirmed = results.filter((confirmed) => !confirmed).length;
    if (unconfirmed > 0) {
      throw new Error(
        `Could not confirm termination of ${unconfirmed} command process tree(s)`,
      );
    }
  }

  private async streamCommand(
    commandId: string,
    fullCommand: string,
    timeout: number | undefined,
    shouldShow: boolean,
    displayText: string,
  ): Promise<void> {
    const startTime = Date.now();
    const commandTimeout = timeout ?? 30000;

    return new Promise<void>((resolve) => {
      let killed = false;
      let timeoutId: NodeJS.Timeout | undefined;

      const spawnSpec = buildShellSpawn(
        DEFAULT_SHELL.shell,
        DEFAULT_SHELL.shellFlag,
        fullCommand,
      );
      const proc = spawn(DEFAULT_SHELL.shell, spawnSpec.args, {
        stdio: ["ignore", "pipe", "pipe"],
        detached: os.platform() !== "win32",
        ...spawnSpec.options,
      });
      this.activeStreamCommands.set(commandId, proc);

      if (commandTimeout > 0) {
        timeoutId = setTimeout(() => {
          killed = true;
          this.terminateProcessTree(proc);
        }, commandTimeout);
      }

      let accumulatedStderr = "";

      proc.stdout?.on("data", (data: Buffer) => {
        const chunk = data.toString();
        this.publishToChannel({
          type: "stdout",
          commandId,
          data: chunk,
        }).catch((err: unknown) => {
          console.error(
            chalk.red(
              `[ERROR] Failed to publish stdout: ${err instanceof Error ? err.message : String(err)}`,
            ),
          );
        });
      });

      proc.stderr?.on("data", (data: Buffer) => {
        const chunk = data.toString();
        accumulatedStderr += chunk;
        this.publishToChannel({
          type: "stderr",
          commandId,
          data: chunk,
        }).catch((err: unknown) => {
          console.error(
            chalk.red(
              `[ERROR] Failed to publish stderr: ${err instanceof Error ? err.message : String(err)}`,
            ),
          );
        });
      });

      proc.on("close", async (code) => {
        if (timeoutId) clearTimeout(timeoutId);
        this.activeStreamCommands.delete(commandId);

        const duration = Date.now() - startTime;
        const exitCode = killed ? 124 : (code ?? 1);

        if (killed) {
          this.publishToChannel({
            type: "stderr",
            commandId,
            data: "\n[Command timed out and was terminated]",
          }).catch((err: unknown) => {
            console.error(
              chalk.red(
                `[ERROR] Failed to publish timeout stderr: ${err instanceof Error ? err.message : String(err)}`,
              ),
            );
          });
        }

        await this.publishToChannel({
          type: "exit",
          commandId,
          exitCode,
        }).catch((err: unknown) => {
          console.error(
            chalk.red(
              `[CRITICAL] Failed to publish EXIT message: ${err instanceof Error ? err.message : String(err)}`,
            ),
          );
        });

        if (shouldShow) {
          if (exitCode === 0) {
            console.log(
              chalk.green(`✓ ${displayText} ${chalk.gray(`(${duration}ms)`)}`),
            );
          } else {
            console.log(
              chalk.red(
                `✗ ${displayText} ${chalk.gray(`(exit ${exitCode}, ${duration}ms)`)}`,
              ),
            );
            if (accumulatedStderr.trim()) {
              const indented = accumulatedStderr
                .trim()
                .split("\n")
                .map((l) => `  ${l}`)
                .join("\n");
              console.log(chalk.red(indented));
            }
          }
        }

        resolve();
      });

      proc.on("error", async (error) => {
        if (timeoutId) clearTimeout(timeoutId);
        this.activeStreamCommands.delete(commandId);
        this.publishToChannel({
          type: "error",
          commandId,
          message: error.message,
        }).catch((err: unknown) => {
          console.error(
            chalk.red(
              `[ERROR] Failed to publish error message: ${err instanceof Error ? err.message : String(err)}`,
            ),
          );
        });
        await this.publishToChannel({
          type: "exit",
          commandId,
          exitCode: 1,
        }).catch((err: unknown) => {
          console.error(
            chalk.red(
              `[CRITICAL] Failed to publish EXIT after process error: ${err instanceof Error ? err.message : String(err)}`,
            ),
          );
        });
        resolve();
      });
    });
  }

  private async spawnBackground(fullCommand: string): Promise<number> {
    const spawnSpec = buildShellSpawn(
      DEFAULT_SHELL.shell,
      DEFAULT_SHELL.shellFlag,
      fullCommand,
    );
    const child = spawn(DEFAULT_SHELL.shell, spawnSpec.args, {
      detached: os.platform() !== "win32",
      stdio: "ignore",
      ...spawnSpec.options,
    });
    child.unref();
    return child.pid ?? -1;
  }

  private async handlePtyCreate(msg: PtyCreateMessage): Promise<void> {
    const { sessionId, command, cols, rows, cwd, env } = msg;

    console.log(chalk.cyan(`[PTY] Creating session ${sessionId}: ${command}`));

    try {
      const opts: ProcessRunOptions = {};
      if (cols !== undefined) opts.cols = cols;
      if (rows !== undefined) opts.rows = rows;
      if (cwd !== undefined) opts.cwd = cwd;
      if (env !== undefined) opts.env = env;

      const result: ProcessRunResult = this.processRunner.run(
        sessionId,
        command,
        opts,
      );

      await this.publishToChannel({
        type: "pty_ready",
        sessionId,
        pid: result.pid,
      });

      console.log(
        chalk.green(`[PTY] Session ${sessionId} ready (pid ${result.pid})`),
      );
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(
        chalk.red(`[PTY] Failed to create session ${sessionId}: ${message}`),
      );
      await this.publishToChannel({
        type: "pty_error",
        sessionId,
        message,
      });
    }
  }

  private handlePtyInput(msg: PtyInputMessage): void {
    const { sessionId, data } = msg;
    const ok = this.processRunner.write(sessionId, data);
    if (!ok) {
      console.warn(chalk.yellow(`[PTY] Write to unknown session ${sessionId}`));
    }
  }

  private handlePtyResize(msg: PtyResizeMessage): void {
    const { sessionId, cols, rows } = msg;
    const ok = this.processRunner.resize(sessionId, cols, rows);
    if (!ok) {
      console.warn(
        chalk.yellow(`[PTY] Resize for unknown session ${sessionId}`),
      );
    }
  }

  private handlePtyKill(msg: PtyKillMessage): void {
    const { sessionId, signal } = msg;
    console.log(
      chalk.yellow(
        `[PTY] Killing session ${sessionId}${signal ? ` (signal: ${signal})` : ""}`,
      ),
    );
    const ok = this.processRunner.stop(sessionId, signal);
    if (!ok) {
      console.warn(chalk.yellow(`[PTY] Kill for unknown session ${sessionId}`));
    }
  }

  private startIdleCheck(): void {
    const timeoutMs = this.config.idleTimeoutMs;
    if (!timeoutMs || timeoutMs <= 0) {
      // Persistent by default: stay connected until revoked from the panel.
      return;
    }
    this.idleCheckInterval = setInterval(() => {
      const idleTime = Date.now() - this.lastActivityTime;
      if (idleTime >= timeoutMs) {
        const idleMinutes = Math.floor(idleTime / 60000);
        console.log(
          chalk.yellow(
            `\n⏰ Idle timeout: no commands received for ${idleMinutes} minutes`,
          ),
        );
        console.log(chalk.yellow("Auto-terminating to save resources..."));
        this.requestExit(0, new Error("Local sandbox idle timeout"));
      }
    }, IDLE_CHECK_INTERVAL_MS);
  }

  private stopIdleCheck(): void {
    if (this.idleCheckInterval) {
      clearInterval(this.idleCheckInterval);
      this.idleCheckInterval = undefined;
    }
  }

  private startUpdatePoll(): void {
    this.updatePollInterval = setInterval(() => {
      void this.checkForAgentUpdate();
    }, UPDATE_POLL_INTERVAL_MS);
  }

  private stopUpdatePoll(): void {
    if (this.updatePollInterval) {
      clearInterval(this.updatePollInterval);
      this.updatePollInterval = undefined;
    }
  }

  // Poll the server for a pending update (set by the Remote Control "Update"
  // button). Read-and-clear on the server, so a failed update won't loop.
  private async checkForAgentUpdate(): Promise<void> {
    if (this.isShuttingDown || this.isUpdating || !this.connectionId) return;
    try {
      const directive = (await this.convexHttp.mutation(
        api.localSandbox.pollAgentUpdate as never,
        {
          token: this.config.token,
          connectionId: this.connectionId,
        } as never,
      )) as {
        updateRequested: boolean;
        targetVersion: string | null;
        revoked?: boolean;
      };
      if (directive?.revoked) {
        // Revoked in the panel → shut down and remove ourselves from this host.
        await this.handleRevoked();
        return;
      }
      if (directive?.updateRequested) {
        await this.performAgentUpdate(directive.targetVersion ?? "latest");
      }
    } catch (error) {
      // Non-fatal: keep running on the current version if the poll fails.
      console.warn(
        chalk.yellow(
          `Agent update check failed: ${
            error instanceof Error ? error.message : String(error)
          }`,
        ),
      );
    }
  }

  // Self-update, Chrome-style: install the new global package, then hand off to
  // the service manager. Under a supervisor (systemd sets INVOCATION_ID) exit(1)
  // so it relaunches us into the new version (restarts under BOTH Restart=always
  // and Restart=on-failure). WITHOUT a supervisor (e.g. `npx @suricatoos/local
  // --token …`, the documented usage) the new version is installed on disk but
  // we keep running the current one and ask the user to restart — better than
  // exiting into nothing, and we never self-respawn (which would double up under
  // non-systemd supervisors: pm2 / Docker restart:always / nssm / launchd).
  // Failed install → stay on the current version (no brick).
  private async performAgentUpdate(targetVersion: string): Promise<void> {
    if (this.isUpdating) return;
    this.isUpdating = true;

    const spec =
      targetVersion && targetVersion !== "latest"
        ? `@suricatoos/local@${targetVersion}`
        : "@suricatoos/local@latest";
    console.log(chalk.cyan(`⬇️  Updating agent to ${spec} ...`));

    const installed = await new Promise<boolean>((resolve) => {
      const child = spawn("npm", ["install", "-g", spec], {
        stdio: "inherit",
        shell: process.platform === "win32",
      });
      child.on("error", (err) => {
        console.error(
          chalk.red(`Agent update: npm failed to start: ${err.message}`),
        );
        resolve(false);
      });
      child.on("exit", (code) => resolve(code === 0));
    });

    if (!installed) {
      console.error(
        chalk.red(
          "Agent update failed (npm install non-zero). Staying on current version.",
        ),
      );
      this.isUpdating = false;
      return;
    }

    if (process.env.INVOCATION_ID) {
      // Supervised (systemd): exit(1) → the service manager relaunches us into
      // the freshly installed version.
      console.log(
        chalk.green("✓ Agent updated. Restarting into the new version..."),
      );
      this.requestExit(
        1,
        new Error("Agent updated; restarting into new version"),
      );
    } else {
      // Unsupervised: nothing would relaunch us, so don't exit — the new version
      // is on disk and takes effect on the next manual restart. Visible, not a
      // silent death, and no duplicate agent.
      console.log(
        chalk.yellow(
          "✓ New agent version installed. Restart the agent to switch to it.",
        ),
      );
      this.isUpdating = false;
    }
  }

  // Revoked from the Remote Control panel: shut down cleanly and remove the
  // agent from this machine so nothing keeps running or lingers in the OS.
  // Exits 0 (not 1) so a supervisor with Restart=on-failure does NOT relaunch
  // us into a connect() the server would now reject.
  private async handleRevoked(): Promise<void> {
    if (this.revoking || this.isShuttingDown || this.exitRequested) return;
    this.revoking = true;
    this.exitRequested = true;

    console.log(
      chalk.yellow("\n🔒 This connector was revoked in the Suricatoos panel."),
    );
    console.log(
      chalk.yellow("Shutting down and removing the agent from this machine..."),
    );

    try {
      await this.cleanup();
    } catch (error) {
      console.warn(
        chalk.yellow(
          `⚠️  Cleanup incomplete: ${
            error instanceof Error ? error.message : String(error)
          }`,
        ),
      );
    }

    await this.selfRemoveFromDisk();

    const reason = new Error("connector revoked");
    if (this.options.onExitRequested) {
      this.options.onExitRequested(0, reason);
    } else {
      process.exit(0);
    }
  }

  // Best-effort on-disk removal for the documented `npx @suricatoos/local`
  // usage: delete the agent's own package directory when it lives in the npx
  // cache, so a revoked connector leaves nothing behind. Scoped to `_npx` cache
  // paths only — never a global or user-managed install — and fully guarded: on
  // Windows the running files are locked and the delete simply no-ops. The
  // process exits regardless, so nothing keeps consuming resources either way.
  private async selfRemoveFromDisk(): Promise<void> {
    try {
      const pkgDir = path.resolve(__dirname, "..");
      const inNpxCache = /[\\/]_npx[\\/]/.test(pkgDir);
      if (!inNpxCache) {
        console.log(
          chalk.gray(
            "ℹ️  Not an npx-cache install; skipped on-disk removal. The process has stopped, so nothing keeps consuming resources.",
          ),
        );
        return;
      }
      await rm(pkgDir, { recursive: true, force: true });
      console.log(chalk.gray("🧽 Removed the agent's npx cache from disk."));
    } catch (error) {
      console.log(
        chalk.gray(
          `ℹ️  Could not remove the on-disk cache (${
            error instanceof Error ? error.message : String(error)
          }); the process has stopped regardless.`,
        ),
      );
    }
  }

  async cleanup(): Promise<void> {
    if (this.cleanupPromise) return this.cleanupPromise;
    this.cleanupPromise = this.performCleanup().catch((error) => {
      this.cleanupPromise = undefined;
      throw error;
    });
    return this.cleanupPromise;
  }

  private async performCleanup(): Promise<void> {
    console.log(chalk.blue("\n🧹 Cleaning up..."));

    this.isShuttingDown = true;
    this.stopIdleCheck();
    this.stopUpdatePoll();

    // Stop all PTY sessions
    this.processRunner.stopAll();

    // Stop all active streamed commands before dropping the realtime connection.
    await this.terminateActiveStreamCommands();

    // Disconnect Centrifugo
    if (this.subscription) {
      this.subscription.unsubscribe();
      this.subscription = undefined;
    }
    this.publishQueue = undefined;
    if (this.centrifuge) {
      this.centrifuge.disconnect();
      this.centrifuge = undefined;
    }

    if (this.connectionId) {
      let disconnectTimeout: NodeJS.Timeout | undefined;
      try {
        await Promise.race([
          this.convexHttp.mutation(
            api.localSandbox.disconnect as never,
            {
              token: this.config.token,
              connectionId: this.connectionId,
            } as never,
          ),
          new Promise<never>(
            (_, reject) =>
              (disconnectTimeout = setTimeout(
                () => reject(new Error("Disconnect timed out after 5 seconds")),
                5_000,
              )),
          ),
        ]);
        console.log(chalk.green("✓ Disconnected"));
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        console.warn(chalk.yellow(`⚠️  Failed to disconnect: ${message}`));
      } finally {
        if (disconnectTimeout) clearTimeout(disconnectTimeout);
      }
    }
  }
}

// Parse command-line arguments
const args = process.argv.slice(2);
const getArg = (flag: string): string | undefined => {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : undefined;
};

const hasFlag = (flag: string): boolean => {
  return args.includes(flag);
};

export function main(): void {
  // Show help
  if (hasFlag("--help") || hasFlag("-h")) {
    console.log(`
${chalk.bold("Suricatoos Local Sandbox Client")}

${chalk.yellow("Usage:")}
  npx @suricatoos/local --token TOKEN [options]

${chalk.yellow("Options:")}
  --token TOKEN       Authentication token from Settings (required)
  --name NAME         Optional connection name fallback (default: hostname)
  --idle-timeout MIN  Auto-terminate after MIN minutes with no commands
                      (default: disabled — stays active until revoked)
  --convex-url URL    Override Convex backend URL (for development)
  --help, -h          Show this help message

${chalk.yellow("Examples:")}
  npx @suricatoos/local --token hsb_abc123
  npx @suricatoos/local --token hsb_abc123 --name "Work PC"
  npx @suricatoos/local --token hsb_abc123 --idle-timeout 60

${chalk.red("⚠️  Security Warning:")}
  Commands run directly on your OS without any isolation.
  Only connect machines you trust and control.

${chalk.cyan("Lifecycle:")}
  The connector stays active until you revoke it in Remote Control settings.
  On revocation it detects it automatically (within ~20s), shuts down, and
  removes itself from this machine so nothing keeps consuming resources.
  Use --idle-timeout to also auto-terminate after a period of inactivity.
`);
    process.exit(0);
  }

  const idleTimeoutMinutes = Number.parseFloat(getArg("--idle-timeout") ?? "");
  const config: Config = {
    convexUrl: getArg("--convex-url") || PRODUCTION_CONVEX_URL,
    token: getArg("--token") || "",
    name: getArg("--name") || os.hostname(),
    idleTimeoutMs:
      Number.isFinite(idleTimeoutMinutes) && idleTimeoutMinutes > 0
        ? idleTimeoutMinutes * 60 * 1000
        : DEFAULT_IDLE_TIMEOUT_MS,
  };

  if (!config.token) {
    console.error(chalk.red("❌ No authentication token provided"));
    console.error(
      chalk.yellow("Usage: npx @suricatoos/local --token YOUR_TOKEN"),
    );
    console.error(
      chalk.yellow("Get your token from Suricatoos Settings > Agents"),
    );
    process.exit(1);
  }

  const client = new LocalSandboxClient(config);

  process.on("SIGINT", async () => {
    console.log(chalk.yellow("\n🛑 Shutting down..."));
    try {
      await client.cleanup();
      process.exit(0);
    } catch (error) {
      console.error(
        chalk.red(
          `Cleanup failed: ${error instanceof Error ? error.message : String(error)}`,
        ),
      );
      process.exit(1);
    }
  });

  process.on("SIGTERM", async () => {
    try {
      await client.cleanup();
      process.exit(0);
    } catch (error) {
      console.error(
        chalk.red(
          `Cleanup failed: ${error instanceof Error ? error.message : String(error)}`,
        ),
      );
      process.exit(1);
    }
  });

  client.start().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(chalk.red("Fatal error:"), message);
    process.exit(1);
  });
}

if (require.main === module) {
  main();
}
