// Loads the in-page rrweb bundle source string.
//
// The bundle (`dist/rrweb-bundle.js`) is produced at build time by
// `scripts/build-rrweb-bundle.mjs` (esbuild → IIFE that defines `window.rrweb`
// with `record` + `getRecordConsolePlugin`). @tracelane/core's recorder is
// bundle-source-agnostic (ADR-0006) and expects this source as a plain string,
// which it `window.eval`s in the page on every (re-)injection.
//
// We read it once and cache it. In the published package this module compiles
// to `dist/inpage-bundle.js`, sitting next to `dist/rrweb-bundle.js`; under
// vitest the source lives in `src/`, so we also probe a sibling `../dist/`. We
// derive the module directory from `fileURLToPath(import.meta.url)` directly
// (not via `new URL(rel, import.meta.url)`) because under the jsdom test env the
// global `URL` resolves relative inputs against the page origin, not the file.

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

let cached: string | undefined;

/** Candidate locations for the built bundle, in priority order. */
function candidatePaths(): string[] {
  const moduleDir = dirname(fileURLToPath(import.meta.url));
  return [
    // Published layout: dist/inpage-bundle.js → dist/rrweb-bundle.js.
    join(moduleDir, 'rrweb-bundle.js'),
    // Source/test layout: src/inpage-bundle.ts → ../dist/rrweb-bundle.js.
    join(moduleDir, '..', 'dist', 'rrweb-bundle.js'),
  ];
}

/**
 * The rrweb in-page bundle source (defines `window.rrweb`). Read from
 * `dist/rrweb-bundle.js`, cached after first read.
 *
 * @throws if the bundle is missing — that means the package was used without its
 *   build step (`pnpm --filter @tracelane/wdio build`) having run.
 */
export function loadRrwebBundle(): string {
  if (cached !== undefined) return cached;
  const candidates = candidatePaths();
  const found = candidates.find((p) => existsSync(p));
  if (found === undefined) {
    throw new Error(
      `@tracelane/wdio: in-page rrweb bundle not found (looked in ${candidates.join(', ')}). Run the package build (\`pnpm --filter @tracelane/wdio build\`) to generate it.`,
    );
  }
  cached = readFileSync(found, 'utf8');
  return cached;
}
