"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { useTranslations } from "next-intl";
import { api } from "@/convex/_generated/api";
import { Button } from "@/components/ui/button";
import {
  Circle,
  Copy,
  RefreshCw,
  AlertTriangle,
  Terminal,
  Server,
  ExternalLink,
  LoaderCircle,
  Check,
  Trash2,
  RotateCcw,
  ArrowUpCircle,
} from "lucide-react";
import { toast } from "sonner";
import { runCommand, convexUrlFlag } from "@/lib/utils/sandbox-command";
import { useGlobalState } from "@/app/contexts/GlobalState";
import { isTauriEnvironment } from "@/app/hooks/useTauri";
import type {
  ChatMode,
  SandboxPreference,
  SelectedModel,
  SubscriptionTier,
} from "@/types/chat";

interface LocalConnection {
  connectionId: string;
  name: string;
  osInfo?: {
    platform: string;
    arch: string;
    release: string;
    hostname: string;
  };
  lastSeen: number;
  isDesktop: boolean;
}

interface UseAutoSelectNewRemoteConnectionArgs {
  connections: LocalConnection[] | undefined;
  chatMode: ChatMode;
  setChatMode: (mode: ChatMode) => void;
  subscription: SubscriptionTier;
  sandboxPreference: SandboxPreference;
  setSandboxPreference: (preference: SandboxPreference) => void;
  selectedModel: SelectedModel;
  setSelectedModel: (model: SelectedModel) => void;
  onNewConnection?: () => void;
}

function useAutoSelectNewRemoteConnection({
  connections,
  chatMode,
  setChatMode,
  subscription,
  sandboxPreference,
  setSandboxPreference,
  selectedModel,
  setSelectedModel,
  onNewConnection,
}: UseAutoSelectNewRemoteConnectionArgs) {
  const t = useTranslations("settingsAgents");
  const previousRemoteConnectionIdsRef = useRef<Set<string> | null>(null);

  useEffect(() => {
    if (connections === undefined) return;

    const remoteConnections = connections.filter((conn) => !conn.isDesktop);
    const currentIds = new Set(
      remoteConnections.map((conn) => conn.connectionId),
    );
    const previousIds = previousRemoteConnectionIdsRef.current;
    previousRemoteConnectionIdsRef.current = currentIds;

    // Treat the first loaded query result as baseline so existing connections
    // do not hijack the user's saved mode on settings open or page load.
    if (previousIds === null) return;

    const newConnection = remoteConnections.find(
      (conn) => !previousIds.has(conn.connectionId),
    );
    if (!newConnection) return;

    onNewConnection?.();

    if (sandboxPreference !== newConnection.connectionId) {
      setSandboxPreference(newConnection.connectionId);
    }

    if (subscription === "free" && selectedModel !== "auto") {
      setSelectedModel("auto");
    }

    if (chatMode !== "agent") {
      setChatMode("agent");
      toast.success(t("remoteControl.connectedSwitchedAgent"));
    } else {
      toast.success(t("remoteControl.connected"));
    }
  }, [
    chatMode,
    connections,
    onNewConnection,
    sandboxPreference,
    selectedModel,
    setChatMode,
    setSandboxPreference,
    setSelectedModel,
    subscription,
    t,
  ]);
}

const copyTextWithExecCommand = (text: string): boolean => {
  if (typeof document === "undefined") return false;

  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.top = "-9999px";
  textarea.style.left = "-9999px";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);

  const selection = document.getSelection();
  const previousRange =
    selection && selection.rangeCount > 0 ? selection.getRangeAt(0) : null;

  textarea.focus();
  textarea.select();
  textarea.setSelectionRange(0, text.length);

  let succeeded = false;
  try {
    succeeded = document.execCommand("copy");
  } catch {
    succeeded = false;
  }

  document.body.removeChild(textarea);

  if (selection && previousRange) {
    selection.removeAllRanges();
    selection.addRange(previousRange);
  }

  return succeeded;
};

const RemoteControlTab = () => {
  const t = useTranslations("settingsAgents");
  const [token, setToken] = useState<string | null>(null);
  const [isPreparingCommand, setIsPreparingCommand] = useState(false);
  const [isResettingToken, setIsResettingToken] = useState(false);
  const [isCommandCopied, setIsCommandCopied] = useState(false);
  const [showConnectSetup, setShowConnectSetup] = useState(false);
  const [updatingIds, setUpdatingIds] = useState<Set<string>>(new Set());
  const copiedResetTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );

  const {
    chatMode,
    setChatMode,
    subscription,
    sandboxPreference,
    setSandboxPreference,
    selectedModel,
    setSelectedModel,
    localConnections: connections,
  } = useGlobalState();

  const tokenResult = useMutation(api.localSandbox.getToken);
  const regenerateToken = useMutation(api.localSandbox.regenerateToken);
  const revokeConnection = useMutation(api.localSandbox.revokeConnection);
  const unrevokeConnection = useMutation(api.localSandbox.unrevokeConnection);
  const revokedConnectors = useQuery(api.localSandbox.listRevokedConnectors);
  const requestAgentUpdate = useMutation(api.localSandbox.requestAgentUpdate);
  const hideConnectSetup = useCallback(() => setShowConnectSetup(false), []);

  useAutoSelectNewRemoteConnection({
    chatMode,
    connections,
    sandboxPreference,
    selectedModel,
    setChatMode,
    setSandboxPreference,
    setSelectedModel,
    subscription,
    onNewConnection: hideConnectSetup,
  });

  useEffect(
    () => () => {
      if (copiedResetTimeoutRef.current) {
        clearTimeout(copiedResetTimeoutRef.current);
      }
    },
    [],
  );

  // Desktop rows report clientVersion "desktop" (a marker), not their real
  // version — read the running app's version from Tauri to show it on the badge.
  const [appVersion, setAppVersion] = useState<string | null>(null);
  useEffect(() => {
    if (!isTauriEnvironment()) return;
    let cancelled = false;
    void (async () => {
      try {
        const { getVersion } = await import("@tauri-apps/api/app");
        const version = await getVersion();
        if (!cancelled) setAppVersion(version);
      } catch {
        // Tauri API unavailable — leave the desktop badge as a plain label.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const activeConnections = connections ?? [];

  const handleCopyConnectCommand = async () => {
    setIsPreparingCommand(true);

    try {
      const commandPromise = (async () => {
        let commandToken = token;

        if (!commandToken) {
          const result = await tokenResult();
          commandToken = result.token;
          setToken(commandToken);
        }

        return `${runCommand} --token ${commandToken}${convexUrlFlag}`;
      })();

      let copied = false;

      // Path A: async ClipboardItem. Handing the promise to ClipboardItem keeps
      // the user gesture alive on Safari/WebKit while the token request is in
      // flight.
      if (
        typeof ClipboardItem !== "undefined" &&
        navigator.clipboard &&
        typeof navigator.clipboard.write === "function"
      ) {
        try {
          await navigator.clipboard.write([
            new ClipboardItem({
              "text/plain": commandPromise.then(
                (command) => new Blob([command], { type: "text/plain" }),
              ),
            }),
          ]);
          copied = true;
        } catch (writeError) {
          // Some embedded webviews (e.g. the desktop app's WKWebView) expose
          // clipboard.write but reject it at runtime. Fall through to the
          // simpler strategies below instead of failing the copy.
          console.warn(
            "clipboard.write failed, falling back to writeText:",
            writeError,
          );
        }
      }

      const command = await commandPromise;

      // Path B: writeText is more broadly supported than write() across
      // browsers and embedded webviews.
      if (
        !copied &&
        navigator.clipboard &&
        typeof navigator.clipboard.writeText === "function"
      ) {
        try {
          await navigator.clipboard.writeText(command);
          copied = true;
        } catch (writeTextError) {
          console.warn(
            "clipboard.writeText failed, falling back to execCommand:",
            writeTextError,
          );
        }
      }

      // Path C: legacy execCommand for contexts where the async Clipboard API
      // is unavailable or blocked (older/embedded webviews, non-secure origins).
      if (!copied) {
        copied = copyTextWithExecCommand(command);
      }

      if (!copied) {
        throw new Error("Clipboard copy failed in all strategies");
      }

      if (copiedResetTimeoutRef.current) {
        clearTimeout(copiedResetTimeoutRef.current);
      }
      setIsCommandCopied(true);
      copiedResetTimeoutRef.current = setTimeout(() => {
        setIsCommandCopied(false);
        copiedResetTimeoutRef.current = null;
      }, 2_000);
      toast.success(t("remoteControl.commandCopied"));
    } catch (error) {
      console.error("Failed to prepare connect command:", error);
      toast.error(t("remoteControl.failedCopyCommand"));
    } finally {
      setIsPreparingCommand(false);
    }
  };

  const handleRegenerateToken = async () => {
    setIsResettingToken(true);

    try {
      const result = await regenerateToken();
      setToken(result.token);
      if (copiedResetTimeoutRef.current) {
        clearTimeout(copiedResetTimeoutRef.current);
        copiedResetTimeoutRef.current = null;
      }
      setIsCommandCopied(false);
      toast.success(t("remoteControl.tokenReset"));
    } catch (error) {
      console.error("Failed to regenerate token:", error);
      toast.error(t("remoteControl.failedResetToken"));
    } finally {
      setIsResettingToken(false);
    }
  };

  const handleRevokeConnection = async (connectionId: string) => {
    try {
      await revokeConnection({ connectionId });
      toast.success(t("remoteControl.connectorRevoked"));
    } catch (error) {
      console.error("Failed to revoke connector:", error);
      toast.error(t("remoteControl.failedRevoke"));
    }
  };

  const handleAllowConnector = async (connectionName: string) => {
    try {
      await unrevokeConnection({ connectionName });
      toast.success(t("remoteControl.connectorAllowed"));
    } catch (error) {
      console.error("Failed to allow connector:", error);
      toast.error(t("remoteControl.failedAllow"));
    }
  };

  const clearUpdating = (connectionId: string) =>
    setUpdatingIds((prev) => {
      const next = new Set(prev);
      next.delete(connectionId);
      return next;
    });

  const handleUpdateAgent = async (connectionId: string) => {
    setUpdatingIds((prev) => new Set(prev).add(connectionId));
    try {
      await requestAgentUpdate({ connectionId });
      toast.success(t("remoteControl.updateStarted"));
    } catch (error) {
      console.error("Failed to request agent update:", error);
      toast.error(t("remoteControl.failedUpdate"));
      clearUpdating(connectionId);
      return;
    }
    // Fallback: the agent picks up the request on its next poll, updates, and
    // reconnects on the new version (updateAvailable flips false, hiding the
    // button reactively). Clear the local spinner after ~90s in case it never
    // comes back.
    setTimeout(() => clearUpdating(connectionId), 90_000);
  };

  return (
    <div className="space-y-5">
      {/* Section Header */}
      <div className="flex items-center justify-between border-b pb-3">
        <div className="flex items-center gap-2">
          <Server className="h-4 w-4 text-muted-foreground" />
          <h3 className="text-sm font-semibold">{t("remoteControl.title")}</h3>
        </div>
        <a
          href="https://help.suricatoos.com/en/articles/12961920-connecting-a-hackerai-agent-to-your-local-machine"
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          <span>{t("remoteControl.learnMore")}</span>
          <ExternalLink className="h-3 w-3" />
        </a>
      </div>

      {/* Active Connections */}
      <div className="space-y-3">
        <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
          {t("remoteControl.connections")}
        </h4>
        {activeConnections.length > 0 ? (
          <div className="space-y-2">
            {activeConnections.map((conn) => (
              <div
                key={conn.connectionId}
                className="flex items-center gap-3 p-3 bg-muted/50 rounded-lg"
              >
                <div className="relative">
                  <Circle className="h-2.5 w-2.5 fill-success text-success" />
                  <Circle className="h-2.5 w-2.5 fill-success text-success absolute inset-0 animate-ping opacity-75" />
                </div>
                <Server className="h-4 w-4 text-muted-foreground shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="font-medium text-sm">
                    {conn.osInfo?.hostname || conn.name}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {conn.isDesktop
                      ? t("remoteControl.desktopAppConnected")
                      : t("remoteControl.remoteControlConnected")}
                  </div>
                </div>
                <span
                  className="shrink-0 rounded-md border bg-background px-1.5 py-0.5 font-mono text-[10px] leading-none text-muted-foreground"
                  title={conn.isDesktop ? "Desktop app" : "Connector version"}
                >
                  {conn.isDesktop
                    ? appVersion
                      ? `v${appVersion}`
                      : "Desktop"
                    : `v${conn.clientVersion}`}
                </span>
                {!conn.isDesktop && conn.updateAvailable ? (
                  <Button
                    variant="default"
                    size="sm"
                    className="h-7 shrink-0 gap-1 px-2 text-xs"
                    onClick={() => handleUpdateAgent(conn.connectionId)}
                    disabled={updatingIds.has(conn.connectionId)}
                    title={t("remoteControl.updateAvailable")}
                  >
                    {updatingIds.has(conn.connectionId) ? (
                      <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <ArrowUpCircle className="h-3.5 w-3.5" />
                    )}
                    {updatingIds.has(conn.connectionId)
                      ? t("remoteControl.updating")
                      : t("remoteControl.update")}
                  </Button>
                ) : null}
                {!conn.isDesktop ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 shrink-0 px-2 text-muted-foreground hover:text-destructive"
                    onClick={() => handleRevokeConnection(conn.connectionId)}
                    aria-label={t("remoteControl.revokeAria", {
                      name: conn.osInfo?.hostname || conn.name,
                    })}
                    title={t("remoteControl.revoke")}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                ) : null}
              </div>
            ))}
            {!showConnectSetup ? (
              <Button
                variant="outline"
                size="sm"
                className="w-full"
                onClick={() => setShowConnectSetup(true)}
              >
                <Terminal className="mr-2 h-3.5 w-3.5" />
                {t("remoteControl.connectAnotherMachine")}
              </Button>
            ) : null}
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center py-6 px-4 bg-muted/30 rounded-lg">
            <div className="h-8 w-8 rounded-full bg-muted flex items-center justify-center mb-2">
              <Server className="h-4 w-4 text-muted-foreground" />
            </div>
            <p className="text-sm font-medium">
              {t("remoteControl.noActiveConnections")}
            </p>
            <p className="text-xs text-muted-foreground">
              {t("remoteControl.connectUsingCommands")}
            </p>
          </div>
        )}
      </div>

      {/* Revoked Connectors */}
      {revokedConnectors && revokedConnectors.length > 0 ? (
        <div className="space-y-3">
          <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
            {t("remoteControl.revokedHeading")}
          </h4>
          <div className="space-y-2">
            {revokedConnectors.map((revoked) => (
              <div
                key={revoked.connectionName}
                className="flex items-center gap-3 p-3 bg-muted/30 rounded-lg"
              >
                <Server className="h-4 w-4 text-muted-foreground shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="font-medium text-sm">
                    {revoked.connectionName}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {t("remoteControl.revokedBlocked")}
                  </div>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 shrink-0 gap-1 px-2 text-xs text-muted-foreground hover:text-foreground"
                  onClick={() => handleAllowConnector(revoked.connectionName)}
                >
                  <RotateCcw className="h-3 w-3" />
                  {t("remoteControl.allowAgain")}
                </Button>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {/* Quick Connect */}
      {activeConnections.length === 0 || showConnectSetup ? (
        <div className="space-y-3">
          <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
            {activeConnections.length > 0
              ? t("remoteControl.connectAnotherMachineHeading")
              : t("remoteControl.quickStart")}
          </h4>
          <div className="overflow-hidden rounded-lg border bg-muted/30">
            <div className="flex items-center gap-2 p-2">
              <Terminal className="ml-1 h-4 w-4 shrink-0 text-muted-foreground" />
              <code className="min-w-0 flex-1 overflow-x-auto whitespace-nowrap py-2 font-mono text-xs text-foreground">
                {`${runCommand} --token <token>${convexUrlFlag}`}
              </code>
              <Button
                size="sm"
                className="shrink-0 gap-1.5"
                onClick={handleCopyConnectCommand}
                disabled={isPreparingCommand || isResettingToken}
                aria-label={
                  isPreparingCommand
                    ? t("remoteControl.ariaPreparing")
                    : isCommandCopied
                      ? t("remoteControl.ariaCopied")
                      : t("remoteControl.ariaCopy")
                }
              >
                {isPreparingCommand ? (
                  <LoaderCircle className="h-4 w-4 animate-spin" />
                ) : isCommandCopied ? (
                  <Check className="h-4 w-4" />
                ) : (
                  <Copy className="h-4 w-4" />
                )}
                <span aria-live="polite">
                  {isPreparingCommand
                    ? t("remoteControl.preparing")
                    : isCommandCopied
                      ? t("remoteControl.copied")
                      : t("remoteControl.copyCommand")}
                </span>
              </Button>
            </div>
            <p className="border-t px-3 py-2 text-xs text-muted-foreground">
              {isPreparingCommand
                ? t("remoteControl.preparingCommand")
                : t("remoteControl.secureTokenIncluded")}
            </p>
          </div>
          <div className="flex items-center justify-between gap-3">
            <p className="text-xs text-muted-foreground">
              {t("remoteControl.pasteAndRun")}
            </p>
            {token ? (
              <Button
                variant="ghost"
                size="sm"
                className="h-7 shrink-0 px-2 text-xs text-muted-foreground hover:text-foreground"
                onClick={handleRegenerateToken}
                disabled={isPreparingCommand || isResettingToken}
              >
                <RefreshCw
                  className={`mr-1 h-3 w-3 ${isResettingToken ? "animate-spin" : ""}`}
                />
                {isResettingToken
                  ? t("remoteControl.resetting")
                  : t("remoteControl.resetToken")}
              </Button>
            ) : null}
          </div>
        </div>
      ) : null}

      {/* Security Notice - Compact */}
      <div className="flex items-start gap-2 p-3 bg-warning/10 rounded-lg text-xs">
        <AlertTriangle className="h-4 w-4 text-warning shrink-0 mt-0.5" />
        <div className="text-foreground space-y-1">
          <span className="font-medium">
            {t("remoteControl.securityLabel")}
          </span>{" "}
          <span className="text-muted-foreground">
            {t("remoteControl.securityNotice")}
          </span>
        </div>
      </div>
    </div>
  );
};

export { RemoteControlTab };
