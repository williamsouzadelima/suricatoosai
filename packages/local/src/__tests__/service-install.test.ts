import { describe, it, expect } from "@jest/globals";
import {
  parseCliCommand,
  parseNpmMajor,
  npmInstallGlobalArgs,
  buildUnitFile,
  buildEnvFileContent,
  ENV_FILE,
} from "../service-install";

describe("parseCliCommand", () => {
  it("selects install/uninstall from the first non-flag token", () => {
    expect(parseCliCommand(["install", "--token", "x"])).toBe("install");
    expect(parseCliCommand(["uninstall"])).toBe("uninstall");
    expect(parseCliCommand(["remove"])).toBe("uninstall");
  });

  it("treats --help/-h as help regardless of position", () => {
    expect(parseCliCommand(["install", "--help"])).toBe("help");
    expect(parseCliCommand(["-h"])).toBe("help");
  });

  it("defaults to foreground run for the legacy --token invocation", () => {
    expect(parseCliCommand(["--token", "x"])).toBe("run");
    expect(parseCliCommand([])).toBe("run");
    // A bare --flag must not be mistaken for a subcommand.
    expect(parseCliCommand(["--name", "box"])).toBe("run");
  });
});

describe("npm install-scripts allowlist gating", () => {
  it("adds --allow-scripts=node-pty only on npm>=11", () => {
    expect(npmInstallGlobalArgs("@suricatoos/local@latest", 11)).toEqual([
      "install",
      "-g",
      "@suricatoos/local@latest",
      "--allow-scripts=node-pty",
    ]);
    expect(npmInstallGlobalArgs("@suricatoos/local@latest", 10)).toEqual([
      "install",
      "-g",
      "@suricatoos/local@latest",
    ]);
  });

  it("parses the npm major version, 0 when unparseable", () => {
    expect(parseNpmMajor("10.9.8")).toBe(10);
    expect(parseNpmMajor("11.0.0\n")).toBe(11);
    expect(parseNpmMajor("garbage")).toBe(0);
  });
});

describe("buildUnitFile", () => {
  const unit = buildUnitFile({
    binPath: "/root/.nvm/versions/node/v22.23.2/bin/suricatoos-local",
    nodeDir: "/root/.nvm/versions/node/v22.23.2/bin",
  });

  it("keeps the token off the command line (read from the EnvironmentFile)", () => {
    // ExecStart is just the bin path — no --token — so the token never leaks via
    // `ps` / `/proc/<pid>/cmdline`.
    expect(unit).toContain(
      "ExecStart=/root/.nvm/versions/node/v22.23.2/bin/suricatoos-local\n",
    );
    expect(unit).not.toContain("--token");
    // It is still provided to the process, from the root-only env file.
    expect(unit).toContain(`EnvironmentFile=${ENV_FILE}`);
    // ...and no real token value is ever baked inline into the unit.
    expect(unit).not.toMatch(/SURICATOOS_TOKEN=\S/);
  });

  it("sets SyslogIdentifier so journald captures the connector's logs", () => {
    expect(unit).toContain("SyslogIdentifier=suricatoos-connector");
  });

  it("uses Restart=on-failure (matches the agent exit-code contract)", () => {
    expect(unit).toContain("Restart=on-failure");
    expect(unit).not.toContain("Restart=always");
  });

  it("prepends the node dir to PATH, sets HOME, reads the env file", () => {
    expect(unit).toContain(
      "Environment=PATH=/root/.nvm/versions/node/v22.23.2/bin:/usr/local/sbin",
    );
    expect(unit).toContain("Environment=HOME=/root");
    expect(unit).toContain(`EnvironmentFile=${ENV_FILE}`);
  });
});

describe("buildEnvFileContent", () => {
  it("writes KEY=VALUE with a trailing newline", () => {
    expect(buildEnvFileContent("hsb_abc123")).toBe(
      "SURICATOOS_TOKEN=hsb_abc123\n",
    );
  });
});
