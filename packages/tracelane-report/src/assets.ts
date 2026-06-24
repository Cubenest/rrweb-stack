// Build-time asset loaders (Task 2.8 + 2.9 + Phase 6 report-revamp fonts).
//
// The self-contained report inlines vendored assets so it opens fully offline
// with nothing fetched at view time:
//   1. the rrweb-player UMD  (defines `window.rrwebPlayer`)            — Task 2.8
//   2. the rrweb-player CSS                                             — Task 2.8
//   3. the fflate UMD gunzip (defines `window.fflate`)                  — Task 2.9
//   4. Fraunces Variable (latin, weight 100-900, normal + italic)       — Phase 6
//   5. JetBrains Mono Variable (latin, weight 100-800, normal)          — Phase 6
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
 * The rrweb-player UMD bundle (~132 KB minified). Inlined verbatim into a
 * top-level `<script>` in the report; its UMD wrapper assigns `window.rrwebPlayer`
 * for the bootstrap script to instantiate.
 *
 * rrweb-player 2.x's `exports` map only exposes `.` and `./dist/style.css`, so
 * neither a deep `dist/*` specifier nor `package.json` is resolvable (the latter
 * rules out the `unpkg`-field trick `readUmdViaUnpkg` uses). We resolve the bare
 * entry (`dist/rrweb-player.cjs`) and read the sibling minified UMD, which —
 * unlike the bare CJS entry — is plain-`<script>`-safe (it sets the global rather
 * than assigning to `module.exports`).
 */
export function loadPlayerUmd(): string {
  const cjsEntry = localRequire.resolve('rrweb-player');
  return readFileSync(cjsEntry.replace(/[^/]+$/, 'rrweb-player.umd.min.cjs'), 'utf8');
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

// ---------------------------------------------------------------------------
// Font assets (Phase 6 report-revamp).
//
// The new report design pairs Fraunces (serif, OFL-1.1) for the hero "what
// failed" headline + section heads with JetBrains Mono (mono, OFL-1.1) for all
// data rows. Both are read as variable-axis woff2 files from `@fontsource-
// variable/*` and embedded as base64 `url(data:font/woff2;base64,…)` inside the
// SHELL_CSS `@font-face` rules — same offline-first posture as the player UMD.
// ---------------------------------------------------------------------------

/**
 * Read a woff2 file out of an `@fontsource-variable/*` package and return its
 * base64-encoded contents. The fontsource packages don't expose the woff2
 * files via their `exports` map directly (the `./files/*.woff2` mapping uses a
 * glob), so we walk to the file via the package's own `package.json` path.
 */
function readFontBase64(packageName: string, fileName: string): string {
  const pkgJsonPath = localRequire.resolve(`${packageName}/package.json`);
  const pkgDirUrl = pathToFileURL(pkgJsonPath.slice(0, pkgJsonPath.lastIndexOf('/') + 1));
  const fontUrl = new URL(`./files/${fileName}`, pkgDirUrl);
  const fontPath = fileURLToPath(fontUrl);
  const pkgDirPath = fileURLToPath(pkgDirUrl);
  if (!fontPath.startsWith(pkgDirPath)) {
    throw new Error(`${packageName}: font file escapes the package directory`);
  }
  return readFileSync(fontPath).toString('base64');
}

/**
 * Fraunces Variable (weight axis 100-900, latin charset, normal style).
 * SIL OFL-1.1 — credited in NOTICE. ~36 KB raw → ~49 KB base64.
 */
export function loadFrauncesNormal(): string {
  return readFontBase64('@fontsource-variable/fraunces', 'fraunces-latin-wght-normal.woff2');
}

/**
 * Fraunces Variable (weight axis 100-900, latin charset, italic style).
 * Same package + license as the normal weight; ~45 KB raw → ~60 KB base64.
 * Used for the headline's emphasized clause and the section heads.
 */
export function loadFrauncesItalic(): string {
  return readFontBase64('@fontsource-variable/fraunces', 'fraunces-latin-wght-italic.woff2');
}

/**
 * JetBrains Mono Variable (weight axis 100-800, latin charset, normal style).
 * SIL OFL-1.1 — credited in NOTICE. ~40 KB raw → ~54 KB base64.
 *
 * Italic intentionally NOT loaded — the data rows (console + network + meta
 * strip + timestamps) never use italics, so the second 43 KB italic woff2
 * would add weight to every report for no design benefit.
 */
export function loadJetBrainsMonoNormal(): string {
  return readFontBase64(
    '@fontsource-variable/jetbrains-mono',
    'jetbrains-mono-latin-wght-normal.woff2',
  );
}
