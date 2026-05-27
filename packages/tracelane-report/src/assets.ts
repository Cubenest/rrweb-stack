// Build-time asset loaders (Task 2.8 + 2.9).
//
// The self-contained report inlines three vendored assets so it opens fully
// offline with nothing fetched at view time:
//   1. the rrweb-player UMD  (defines `window.rrwebPlayer`)   — Task 2.8
//   2. the rrweb-player CSS                                    — Task 2.8
//   3. the fflate UMD gunzip (defines `window.fflate`)         — Task 2.9
//
// Each is read from the installed package via `require.resolve`, NOT hand-pasted
// into source (the assets are large and would bloat/obscure the diff, and they
// must track the pinned dependency versions). The reads happen at report-build
// time in Node, so they cost nothing at view time.

import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

// A CJS-style require rooted at this module's location, so `require.resolve`
// finds the dependencies through the normal node_modules resolution that pnpm
// set up — robust to where the compiled `dist/` ends up on disk.
const localRequire = createRequire(import.meta.url);

function readAsset(specifier: string): string {
  return readFileSync(localRequire.resolve(specifier), 'utf8');
}

/**
 * Resolve a UMD entry that the package's `exports` map hides behind a deep path
 * (fflate exports only `.` / `./browser` / `./node`, so
 * `require.resolve('fflate/umd/index.js')` is blocked). We resolve the always-
 * exported `package.json`, read its `unpkg` (the declared CDN/UMD entry), and
 * resolve it against the package directory's `file:` URL — `new URL` normalizes
 * the relative path (no manual string join), and a containment check rejects a
 * `unpkg` value that would escape the package directory.
 */
function readUmdViaUnpkg(packageName: string): string {
  const pkgJsonPath = localRequire.resolve(`${packageName}/package.json`);
  const pkg = JSON.parse(readFileSync(pkgJsonPath, 'utf8')) as { unpkg?: string };
  const unpkg = pkg.unpkg;
  if (typeof unpkg !== 'string') {
    throw new Error(`${packageName}: package.json has no "unpkg" UMD entry to inline`);
  }
  // Resolve `unpkg` relative to the package.json file URL (its last segment is
  // replaced), then re-derive a normalized path.
  const pkgDirUrl = pathToFileURL(pkgJsonPath.slice(0, pkgJsonPath.lastIndexOf('/') + 1));
  const assetPath = fileURLToPath(new URL(unpkg, pkgDirUrl));
  const pkgDirPath = fileURLToPath(pkgDirUrl);
  if (!assetPath.startsWith(pkgDirPath)) {
    throw new Error(`${packageName}: "unpkg" entry escapes the package directory`);
  }
  return readFileSync(assetPath, 'utf8');
}

/**
 * The rrweb-player UMD bundle (~115 KB). Inlined verbatim into a top-level
 * `<script>` in the report; its `var rrwebPlayer = (function(){…})()` IIFE then
 * exposes `window.rrwebPlayer` for the bootstrap script to instantiate.
 */
export function loadPlayerUmd(): string {
  return readAsset('rrweb-player/dist/index.js');
}

/**
 * The rrweb-player stylesheet (~5 KB). Self-contained (cursor SVGs are inline
 * data URIs), so it inlines into a `<style>` with no external fetches.
 */
export function loadPlayerCss(): string {
  return readAsset('rrweb-player/dist/style.css');
}

/**
 * The fflate UMD (~33 KB). Inlined into a top-level `<script>`; its UMD wrapper
 * assigns `window.fflate` (with `gunzipSync` + `strFromU8`) so the bootstrap
 * script can decompress the embedded event blob in-page (Task 2.9). Chosen over
 * pako for consistency with `@cubenest/rrweb-core`'s fflate-based `compress()`.
 */
export function loadFflateGunzipSource(): string {
  return readUmdViaUnpkg('fflate');
}
