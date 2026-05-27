// Build the MAIN-world recorder into `<outDir>/rrweb-recorder.js` as a
// self-contained IIFE (Task 3.19, P2 PRD §A.2).
//
// This is the load-bearing build step for the MAIN/ISOLATED split. WXT/Vite
// emit ES modules and CRXJS loads content scripts via dynamic import +
// chrome.runtime.getURL — neither works in a `world: 'MAIN'` script (crxjs
// discussion #643). So the recorder is NOT a WXT entrypoint; esbuild compiles
// `src/recorder/recorder-entry.ts` with `format: 'iife'`, inlining every
// transitive dependency of @cubenest/rrweb-core, into one classic script with
// no import/export. assert-recorder-iife.mjs enforces that invariant in CI.
//
// Invoked from wxt.config.ts's `build:done` hook (so it tracks the real output
// directory and runs on every `wxt build` / `wxt dev`), and standalone for the
// IIFE assertion.
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const here = (rel) => fileURLToPath(new URL(rel, import.meta.url));

/**
 * @param {string} outFile absolute path to write the IIFE bundle to.
 * @returns {Promise<string>} the outFile that was written.
 */
export async function buildRecorder(outFile) {
  await build({
    entryPoints: [here('../src/recorder/recorder-entry.ts')],
    outfile: outFile,
    bundle: true,
    // The whole point: a classic IIFE, no module syntax, no dynamic import.
    format: 'iife',
    platform: 'browser',
    target: 'es2020',
    // Smaller injected source — re-injected on every navigation.
    minify: true,
    legalComments: 'none',
    logLevel: 'info',
    // esbuild resolves bare imports (@cubenest/rrweb-core) from the entry's
    // dir up through node_modules, which pnpm hoists at the package root.
  });
  return outFile;
}

// Standalone invocation: `node scripts/build-recorder.mjs <outFile>`.
// Defaults to the chrome-mv3 dev output dir so the IIFE assertion can run it
// without a full `wxt build`.
if (import.meta.url === `file://${process.argv[1]}`) {
  const outFile = process.argv[2]
    ? fileURLToPath(new URL(process.argv[2], `file://${process.cwd()}/`))
    : here('../.output/chrome-mv3/rrweb-recorder.js');
  const written = await buildRecorder(outFile);
  // eslint-disable-next-line no-console
  console.log(`[peek] MAIN-world recorder IIFE written to ${written}`);
}
