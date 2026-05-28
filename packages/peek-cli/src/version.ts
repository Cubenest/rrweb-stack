// CLI version string surfaced by `peek --version` / `peek --help`.
//
// Read at runtime from this package's package.json (via `createRequire` to
// keep an awkward JSON ESM import out of the source) so the printed version
// always matches what npm shipped. The previous hardcoded literal drifted
// out of sync with package.json across the alpha.0 → alpha.2 bumps because
// Changesets only edits package.json, not source literals (P-8 bug found in
// the 2026-05-28 QA walk).
//
// The relative path is from the compiled dist/version.js → ../package.json.

import { createRequire } from 'node:module';

const _require = createRequire(import.meta.url);
const _pkg = _require('../package.json') as { version: string };

export const CLI_VERSION = _pkg.version;
