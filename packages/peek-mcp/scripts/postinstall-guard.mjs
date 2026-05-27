#!/usr/bin/env node
// pnpm runs `postinstall` on every `pnpm install`, including in this monorepo
// before the package has been built (no dist/ yet) and in CI. Running the real
// postinstall against a missing dist would spew a module-not-found stack, so
// this guard only delegates when the built entry exists. It never fails the
// install.

import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pathToFileURL } from 'node:url';

const pkgRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const postinstall = join(pkgRoot, 'dist', 'postinstall.js');

if (existsSync(postinstall)) {
  try {
    await import(pathToFileURL(postinstall).href);
  } catch (err) {
    console.log(`peek: postinstall skipped — ${err instanceof Error ? err.message : String(err)}`);
  }
} else {
  // Building from source (monorepo / CI): nothing to register yet.
}
