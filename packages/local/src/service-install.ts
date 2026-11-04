/**
 * Pure helpers for `suricatoos-local install` / `uninstall` (the systemd service
 * lifecycle). Deliberately free of I/O so they can be unit-tested; the actual
 * systemctl / filesystem / npm calls live in the install/uninstall handlers in
 * index.ts (the thin shell, exercised on a real Linux box).
 */

export const SERVICE_NAME = "suricatoos-connector";
export const ENV_DIR = "/etc/suricatoos";
export const ENV_FILE = `${ENV_DIR}/connector.env`;
export const UNIT_PATH = `/etc/systemd/system/${SERVICE_NAME}.service`;

export type CliCommand = "install" | "uninstall" | "help" | "run";

/**
 * Decide which subcommand to run from argv (process.argv.slice(2)). --help/-h
 * anywhere wins; the first non-flag token selects install/uninstall; otherwise
 * the legacy "run the connector in the foreground" behavior (unchanged).
 */
export function parseCliCommand(args: string[]): CliCommand {
  if (args.includes("--help") || args.includes("-h")) return "help";
  const first = args.find((a) => !a.startsWith("-"));
  if (first === "install") return "install";
  if (first === "uninstall" || first === "remove") return "uninstall";
  return "run";
}

/**
 * Parse the major version from `npm -v` output ("10.9.8" -> 10). Returns 0 when
 * unparseable, which callers treat as "old npm" (no allowlist flag).
 */
export function parseNpmMajor(npmVersion: string): number {
  const match = /^\s*(\d+)\./.exec(npmVersion);
  return match ? Number.parseInt(match[1], 10) : 0;
}

/**
 * Args for `npm install -g <spec>`. npm >= 11 gates a dependency's install
 * scripts behind an allowlist; node-pty (the optional PTY dep) needs its native
 * build, so allow it there. Older npm runs scripts by default and must NOT see
 * the flag (it would be an unknown arg). node-pty staying unbuilt only disables
 * interactive terminals; the connector still runs non-interactive commands.
 */
export function npmInstallGlobalArgs(spec: string, npmMajor: number): string[] {
  const base = ["install", "-g", spec];
  return npmMajor >= 11 ? [...base, "--allow-scripts=node-pty"] : base;
}

export interface UnitFileOptions {
  /** Absolute path to the suricatoos-local bin. */
  binPath: string;
  /** Directory holding the node binary; prepended to the unit's PATH. */
  nodeDir: string;
  /** Env file holding SURICATOOS_TOKEN (default ENV_FILE). */
  envFile?: string;
}

/**
 * The systemd unit. Restart=on-failure is deliberate and matches the agent's
 * exit-code contract: self-update exits 1 (failure) -> relaunched into the
 * freshly installed version; revocation exits 0 (success) -> stays stopped (so
 * a revoked connector does not busy-loop into a connect() the server rejects).
 * HOME=/root so the agent's self-update `npm` reads root's config. The token is
 * passed via systemd's ${SURICATOOS_TOKEN} expansion from the root-only env
 * file — never written inline into the unit.
 */
export function buildUnitFile(options: UnitFileOptions): string {
  const envFile = options.envFile ?? ENV_FILE;
  return `[Unit]
Description=Suricatoos Remote Control connector (@suricatoos/local)
Documentation=https://help.suricatoos.com/
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
Environment=HOME=/root
Environment=PATH=${options.nodeDir}:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
EnvironmentFile=${envFile}
ExecStart=${options.binPath} --token \${SURICATOOS_TOKEN}
Restart=on-failure
RestartSec=3

[Install]
WantedBy=multi-user.target
`;
}

/** Contents of the root-only env file (written chmod 600; token never logged). */
export function buildEnvFileContent(token: string): string {
  return `SURICATOOS_TOKEN=${token}\n`;
}
