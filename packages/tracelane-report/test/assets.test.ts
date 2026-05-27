import { describe, expect, it } from 'vitest';
import { loadFflateGunzipSource, loadPlayerCss, loadPlayerUmd } from '../src/assets';

// Task 2.8 + 2.9 — the inlined build-time assets. These are read from the
// installed packages (rrweb-player, fflate) via require.resolve, so the report
// is self-contained: nothing is fetched at view time.
describe('build-time assets', () => {
  it('loads the rrweb-player UMD as a non-trivial string', () => {
    const umd = loadPlayerUmd();
    expect(typeof umd).toBe('string');
    // The real UMD is ~115 KB; guard against an accidental empty/placeholder.
    expect(umd.length).toBeGreaterThan(50_000);
  });

  it('the player UMD defines the rrwebPlayer global and is plain-script-safe', () => {
    const umd = loadPlayerUmd();
    // IIFE assigns `var rrwebPlayer = ...` — becomes window.rrwebPlayer when
    // inlined in a top-level <script>.
    expect(umd).toContain('rrwebPlayer');
    // Must NOT contain ESM export statements that would throw in a plain script.
    expect(umd).not.toMatch(/^export\{/m);
    expect(umd).not.toMatch(/\bexport\s+default\b/);
  });

  it('loads the rrweb-player CSS as a non-trivial string', () => {
    const css = loadPlayerCss();
    expect(typeof css).toBe('string');
    expect(css.length).toBeGreaterThan(500);
    // Known rrweb-player selector.
    expect(css).toContain('.replayer-wrapper');
  });

  it('loads the fflate gunzip source as a plain-script-safe string', () => {
    const src = loadFflateGunzipSource();
    expect(typeof src).toBe('string');
    expect(src.length).toBeGreaterThan(2_000);
    // The UMD exposes a global `fflate` with gunzipSync.
    expect(src).toContain('gunzipSync');
    expect(src).not.toMatch(/^export\{/m);
  });
});
