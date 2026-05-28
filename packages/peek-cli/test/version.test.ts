import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { CLI_VERSION } from '../src/version.js';

// Regression: CLI_VERSION used to be hardcoded `'0.1.0-alpha.0'` and drifted
// out of sync as the package bumped to alpha.1 / alpha.2 (Changesets only
// edits package.json, not source literals — P-8 in the 2026-05-28 QA walk).
// Now read at runtime via createRequire — assert it always matches package.json
// so a future revert is caught.
describe('CLI_VERSION', () => {
  it('matches package.json version (no hardcode drift)', () => {
    const pkgPath = join(fileURLToPath(import.meta.url), '..', '..', 'package.json');
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as { version: string };
    expect(CLI_VERSION).toBe(pkg.version);
  });
});
