#!/usr/bin/env node
// Postbuild: tsc emits .js/.d.ts but not file modes. chmod +x the bin so the
// `#!/usr/bin/env node` shebang is honored when npx / a shell spawns it.
import { chmodSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const pkgRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const bin = join(pkgRoot, "dist", "index.js");
if (existsSync(bin)) chmodSync(bin, 0o755);
console.log("postbuild: made peek-connector-slack bin executable");
