// Ensure the published bin is executable. `tsc` emits dist/index.js as 0644,
// and `npm publish` preserves that mode in the tarball. npm/npx normally add
// +x when linking a bin, but a reused/half-populated npx cache can serve the
// 0644 file directly, which fails with "sh: suricatoos-local: Permission
// denied". Shipping the bin as 0755 removes that dependency entirely.
//
// Runs after `tsc` in the build (and therefore before `npm publish` via
// prepublishOnly -> build). chmod on Windows only toggles the read-only bit,
// which is harmless; the package is published from a unix box.
import { chmodSync } from "node:fs";
import { fileURLToPath } from "node:url";

const bin = fileURLToPath(new URL("../dist/index.js", import.meta.url));
chmodSync(bin, 0o755);
console.log("make-bin-executable: chmod 0755 dist/index.js");
