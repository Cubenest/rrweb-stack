// Loads the in-page rrweb bundle source string.
//
// The bundle (`dist/rrweb-bundle.js`) is produced at build time by
// `scripts/build-rrweb-bundle.mjs` (esbuild → IIFE that defines `window.rrweb`
// with `record` + `getRecordConsolePlugin`). @tracelane/core's recorder is
// bundle-source-agnostic (ADR-0006) and expects this source as a plain string,
// which it `window.eval`s in the page on every (re-)injection.
//
// We read it once and cache it. The file sits next to this module's compiled
// output in `dist/`, so we resolve it relative to `import.meta.url` — robust to
// wherever the installed package's `dist/` lands on disk.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

let cached: string | undefined;

/**
 * The rrweb in-page bundle source (defines `window.rrweb`). Read from
 * `dist/rrweb-bundle.js`, cached after first read.
 *
 * @throws if the bundle is missing — that means the package was used without its
 *   build step (`pnpm --filter @tracelane/wdio build`) having run.
 */
export function loadRrwebBundle(): string {
  if (cached !== undefined) return cached;
  const bundlePath = fileURLToPath(new URL('./rrweb-bundle.js', import.meta.url));
  try {
    cached = readFileSync(bundlePath, 'utf8');
  } catch (cause) {
    throw new Error(
      `@tracelane/wdio: in-page rrweb bundle not found at ${bundlePath}. Run the package build (\`pnpm --filter @tracelane/wdio build\`) to generate it.`,
      { cause },
    );
  }
  return cached;
}
