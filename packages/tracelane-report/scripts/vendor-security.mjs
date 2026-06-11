// Vendor the internal @tracelane/security analyzer source into this package.
//
// @tracelane/security is a PRIVATE workspace package (never published) — it's an
// implementation detail of the report, not a public API. To ship a self-contained
// @tracelane/report without a runtime dependency on it, we copy its source into
// `src/_security/` and compile it in with the rest of the report (plain tsc). The
// copy is a build artifact (gitignored); the private package stays the single
// source of truth. Run before tsc/vitest by the package's build/typecheck/test
// scripts.
import { cpSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const src = join(here, '..', '..', 'tracelane-security', 'src');
const dest = join(here, '..', 'src', '_security');

rmSync(dest, { recursive: true, force: true });
mkdirSync(dest, { recursive: true });
cpSync(src, dest, { recursive: true });
console.log('[tracelane/report] vendored @tracelane/security src -> src/_security');
