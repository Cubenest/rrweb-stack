#!/usr/bin/env node
// Postbuild: tsc only emits .js/.d.ts, so copy the non-TS runtime assets the
// built code resolves relative to itself — the SQL migration files and the
// extension-ids.json — into dist/, and make the bin entry executable so the
// shebang works when the browser / npx spawns it.

import { chmodSync, copyFileSync, cpSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const pkgRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const src = join(pkgRoot, 'src');
const dist = join(pkgRoot, 'dist');

// 1. Migrations directory -> dist/db/migrations (resolved via import.meta.url).
const migrationsSrc = join(src, 'db', 'migrations');
const migrationsDist = join(dist, 'db', 'migrations');
mkdirSync(migrationsDist, { recursive: true });
cpSync(migrationsSrc, migrationsDist, { recursive: true });

// 2. extension-ids.json -> dist/native-host/extension-ids.json.
const idsSrc = join(src, 'native-host', 'extension-ids.json');
const idsDist = join(dist, 'native-host', 'extension-ids.json');
mkdirSync(dirname(idsDist), { recursive: true });
copyFileSync(idsSrc, idsDist);

// 3. chmod +x the bin entry so the `#!/usr/bin/env node` shebang is honored.
const bin = join(dist, 'index.js');
if (existsSync(bin)) {
  chmodSync(bin, 0o755);
}

console.log('postbuild: copied migrations + extension-ids.json into dist and made bin executable');
