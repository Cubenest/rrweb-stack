#!/usr/bin/env node
// Postbuild: tsc only emits .js/.d.ts. We also (1) chmod +x the bin entry so
// the `#!/usr/bin/env node` shebang is honored when npx / a shell spawns
// `peek`, and (2) copy the canonical `skills/peek-skill.md` into `dist/` so
// the installed package (where users invoke `peek init`) can read it from a
// path relative to the running JS — without re-bundling the markdown into a
// TS string and losing diffability.

import { chmodSync, cpSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const pkgRoot = dirname(dirname(fileURLToPath(import.meta.url)));

const bin = join(pkgRoot, 'dist', 'index.js');
if (existsSync(bin)) {
  chmodSync(bin, 0o755);
}

const skillsSrc = join(pkgRoot, 'skills');
const skillsDst = join(pkgRoot, 'dist', 'skills');
if (existsSync(skillsSrc)) {
  cpSync(skillsSrc, skillsDst, { recursive: true });
}

console.log('postbuild: made peek bin executable + copied skills/ → dist/skills/');
