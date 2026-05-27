#!/usr/bin/env node
// Postbuild: tsc only emits .js/.d.ts. chmod +x the bin entry so the
// `#!/usr/bin/env node` shebang is honored when npx / a shell spawns `peek`.

import { chmodSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const pkgRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const bin = join(pkgRoot, 'dist', 'index.js');
if (existsSync(bin)) {
  chmodSync(bin, 0o755);
}

console.log('postbuild: made peek bin executable');
