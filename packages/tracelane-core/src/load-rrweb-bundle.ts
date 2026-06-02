// Loads the in-page rrweb bundle source string (framework-agnostic).
//
// Each adapter (WDIO, Playwright) ships its own `dist/rrweb-bundle.js` — an
// esbuild IIFE that defines `window.rrweb` with `record` +
// `getRecordConsolePlugin` (+ `getRecordNetworkPlugin`). The recorder is
// bundle-source-agnostic (ADR-0006) and expects this source as a plain string,
// which it `window.eval`s in the page on every (re-)injection.
//
// This loader lives in @tracelane/core so every adapter shares one
// implementation. The adapter passes its own `import.meta.url` so the candidate
// paths resolve relative to the ADAPTER's module (where its bundle sits), not to
// core. We derive the module directory from `fileURLToPath(moduleUrl)` directly
// (not via `new URL(rel, moduleUrl)`) because under the jsdom test env the
// global `URL` resolves relative inputs against the page origin, not the file.

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Default candidate locations for the built bundle relative to `moduleUrl`, in
 * priority order. Mirrors the historical wdio layout:
 *   - Published: `dist/<loader>.js` sits next to `dist/rrweb-bundle.js`.
 *   - Source/test: `src/<loader>.ts` → `../dist/rrweb-bundle.js`.
 */
function defaultCandidatePaths(moduleUrl: string): string[] {
  const moduleDir = dirname(fileURLToPath(moduleUrl));
  return [join(moduleDir, 'rrweb-bundle.js'), join(moduleDir, '..', 'dist', 'rrweb-bundle.js')];
}

/**
 * Read the rrweb in-page bundle source (defines `window.rrweb`) off disk.
 *
 * @param moduleUrl       the calling adapter's `import.meta.url`; candidate
 *                        paths resolve relative to this module.
 * @param candidatePaths  optional explicit candidate paths (overrides the
 *                        defaults). The first that exists is read.
 * @returns the bundle source string.
 * @throws if no candidate exists — that means the package was used without its
 *   build step having run.
 */
export function loadRrwebBundle(moduleUrl: string, candidatePaths?: string[]): string {
  const candidates =
    candidatePaths && candidatePaths.length > 0 ? candidatePaths : defaultCandidatePaths(moduleUrl);
  const found = candidates.find((p) => existsSync(p));
  if (found === undefined) {
    throw new Error(
      `tracelane: in-page rrweb bundle not found (looked in ${candidates.join(', ')}). Run the package build to generate dist/rrweb-bundle.js.`,
    );
  }
  return readFileSync(found, 'utf8');
}
