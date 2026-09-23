// Fails the build if AGENT_VERSION (src/index.ts) diverges from "version"
// (package.json). Runs as prebuild, so it also covers `npm publish`
// (prepublishOnly -> build) — which is exactly where the drift hurts.
import { readFileSync } from "node:fs";

const root = new URL("../", import.meta.url);
const pkg = JSON.parse(readFileSync(new URL("package.json", root), "utf8"));
const src = readFileSync(new URL("src/index.ts", root), "utf8");

const m = src.match(/^const AGENT_VERSION = "([^"]+)";/m);
if (!m) {
  console.error(
    'check-version-sync: could not find `const AGENT_VERSION = "..."` in src/index.ts',
  );
  process.exit(1);
}
if (m[1] !== pkg.version) {
  console.error(
    `check-version-sync: AGENT_VERSION="${m[1]}" differs from package.json version="${pkg.version}".\n` +
      "Update both (and LATEST_AGENT_VERSION in convex/localSandbox.ts, which is a separate deploy).",
  );
  process.exit(1);
}
console.log(`check-version-sync: ok (${pkg.version})`);
