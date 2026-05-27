import { fileURLToPath } from 'node:url';
// Build step: bundle the in-page rrweb recorder into `dist/rrweb-bundle.js`.
//
// @cubenest/rrweb-core is ESM-only and has no UMD build, but the recorder needs
// a self-contained source string it can `window.eval` in the page to define
// `window.rrweb` (ADR-0006). esbuild bundles `rrweb-bundle-entry.mjs` (which
// assigns `record` + `getRecordConsolePlugin` onto `window.rrweb`) into a single
// IIFE with every transitive dependency inlined.
//
// Run after `tsc` (so `dist/` exists) by the package `build` script, and also
// standalone by `test:e2e` (the E2E needs the bundle but not a full build).
import { build } from 'esbuild';

const entry = fileURLToPath(new URL('./rrweb-bundle-entry.mjs', import.meta.url));
const outfile = fileURLToPath(new URL('../dist/rrweb-bundle.js', import.meta.url));

await build({
  entryPoints: [entry],
  outfile,
  bundle: true,
  format: 'iife',
  platform: 'browser',
  target: 'es2020',
  // Minify to keep the injected source small — it is re-`window.eval`'d on every
  // navigation, so smaller is cheaper over the wire and in parse time.
  minify: true,
  legalComments: 'none',
  logLevel: 'info',
  // esbuild resolves bare imports (@cubenest/rrweb-core) from the entry file's
  // directory up through node_modules, which pnpm hoists at the package root.
});

console.log(`[tracelane/wdio] rrweb in-page bundle written to ${outfile}`);
