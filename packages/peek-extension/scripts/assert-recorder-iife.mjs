// Assert the built MAIN-world recorder is a classic IIFE with NO ES-module
// syntax (Task 3.19 acceptance gate, P2 PRD §A.2 IIFE constraint).
//
// A `world: 'MAIN'` script runs as a classic script; if WXT/esbuild ever emit
// `import`/`export` (or a dynamic `import(`), the recorder silently fails to
// load in the page and recording breaks with no error in the extension. This
// check builds the bundle fresh and fails the build if module syntax leaks in.
//
// Run by `pnpm assert:recorder-iife` (wired into the package `build` script and
// CI). Exits non-zero on violation.
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildRecorder } from './build-recorder.mjs';

// Two-part check.
//
// (1) STRUCTURAL — the decisive one. esbuild's `format:'iife'` wraps the whole
//     program in an arrow/function IIFE: `"use strict";(()=>{…})();`. With
//     `format:'esm'` (the failure mode this gate exists to catch) the top level
//     is bare (`var …`) with no wrapper. We require the IIFE envelope at the
//     start. This distinguishes the two even for an entry that — like ours —
//     has no surviving imports/exports after bundling, where a text scan for
//     module keywords can't tell them apart.
//
// (2) MODULE-SYNTAX scan — a secondary guard against a stray static `import …
//     from` / `export {` that bundling failed to inline (e.g. a dep marked
//     `external`). Patterns target concrete ESM syntax, not the bare word
//     `import` (which appears inside rrweb's "Please stop import mirror…"
//     warning string).
const IIFE_ENVELOPE = /^(?:"use strict";|'use strict';)?\s*[!;]?\(\s*(?:function\b|\(|async\b)/;

const FORBIDDEN = [
  {
    name: 'export statement',
    re: /(^|[;}\s])export\s*(\{|default[\s{]|(var|let|const|function|class)[\s*])/,
  },
  { name: 'import…from', re: /(^|[;}\s])import\b[^;]*?\bfrom\s*['"]/ },
  { name: 'bare import', re: /(^|[;}\s])import\s*['"]/ },
];

const tmp = await mkdtemp(join(tmpdir(), 'peek-recorder-'));
const outFile = join(tmp, 'rrweb-recorder.js');
try {
  await buildRecorder(outFile);
  const code = await readFile(outFile, 'utf8');

  if (!IIFE_ENVELOPE.test(code)) {
    // eslint-disable-next-line no-console
    console.error(
      `[peek] FAIL: rrweb-recorder.js is not wrapped in an IIFE envelope.\nFirst 80 chars: ${JSON.stringify(code.slice(0, 80))}\nMAIN-world scripts must be a classic IIFE (P2 PRD §A.2). Check esbuild \`format\`.`,
    );
    process.exit(1);
  }

  const violations = FORBIDDEN.filter(({ re }) => re.test(code)).map(({ name }) => name);
  if (violations.length > 0) {
    // eslint-disable-next-line no-console
    console.error(
      `[peek] FAIL: rrweb-recorder.js contains ES-module syntax — found ${violations.join(', ')}.\nA dependency did not inline. MAIN-world scripts must be classic IIFE (P2 PRD §A.2).`,
    );
    process.exit(1);
  }

  // Sanity: a real IIFE bundle is non-trivial (rrweb is bundled in).
  if (code.length < 1000) {
    // eslint-disable-next-line no-console
    console.error(
      `[peek] FAIL: rrweb-recorder.js is only ${code.length} bytes — rrweb did not bundle in.`,
    );
    process.exit(1);
  }

  // eslint-disable-next-line no-console
  console.log(
    `[peek] OK: rrweb-recorder.js is a classic IIFE (${code.length} bytes, no import/export).`,
  );
} finally {
  await rm(tmp, { recursive: true, force: true });
}
