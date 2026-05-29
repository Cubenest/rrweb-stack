// In-page bundle entry — the source esbuild compiles into `dist/rrweb-bundle.js`.
//
// @tracelane/core's recorder injects an rrweb UMD/IIFE source string into the
// page (it is bundle-source-agnostic; ADR-0006). This entry is that source:
// it imports the recorder + console plugin + network plugin from the ESM-only
// @cubenest/rrweb-core substrate and assigns them onto `window.rrweb` so the
// in-page init script (`tracelaneInitScript`) finds `window.rrweb.record`,
// `window.rrweb.getRecordConsolePlugin`, and `window.rrweb.getRecordNetworkPlugin`.
//
// esbuild bundles this (format: 'iife', platform: 'browser') so every transitive
// dependency of the substrate is inlined — the produced file runs in the page
// with zero module resolution. It is `.mjs` (not .ts) so the bundle build needs
// no TypeScript step and can run before/independently of `tsc`.
import { getRecordConsolePlugin, getRecordNetworkPlugin, record } from '@cubenest/rrweb-core';

// The init script reads exactly these three members off `window.rrweb`.
window.rrweb = { record, getRecordConsolePlugin, getRecordNetworkPlugin };
