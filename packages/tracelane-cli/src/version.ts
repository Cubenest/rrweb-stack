// CLI version surfaced by `tracelane --version` / `tracelane --help`.
//
// Read at runtime from this package's package.json (via `createRequire` to
// keep an awkward JSON ESM import out of the source) so the printed version
// always matches what npm shipped — same pattern peek-cli/src/version.ts
// uses to dodge the P-8 drift bug (a hardcoded literal getting out of sync
// with Changesets-driven version bumps).
//
// The relative path is from the compiled dist/version.js → ../package.json.

import { createRequire } from 'node:module';

const _require = createRequire(import.meta.url);
const _pkg = _require('../package.json') as { version: string };

export const CLI_VERSION = _pkg.version;
