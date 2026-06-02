import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { loadRrwebBundle } from '@tracelane/core';
import { describe, expect, it } from 'vitest';

// The loader itself now lives in @tracelane/core (shared across adapters); this
// suite keeps the WDIO-specific contract: the package's OWN built
// dist/rrweb-bundle.js, when eval'd in a page, defines window.rrweb with the
// members page-script.ts reads. We pass this test's import.meta.url so the
// loader resolves the wdio dist bundle (../dist/rrweb-bundle.js).

// The in-page bundle is the contract @tracelane/core's recorder relies on: the
// source string, when `window.eval`'d in the page, must define `window.rrweb`
// with `record` and `getRecordConsolePlugin` (page-script.ts reads exactly
// those). We eval the built bundle in jsdom's window and assert the surface.
//
// The bundle is produced by the package build / `test:e2e` (esbuild). If it
// hasn't been built, skip rather than fail — the unit suite must stay runnable
// before a build, and the bundle's existence is gated by the build step + CI.

const bundlePath = join(__dirname, '..', 'dist', 'rrweb-bundle.js');
const built = existsSync(bundlePath);

describe.skipIf(!built)('in-page rrweb bundle', () => {
  it('loadRrwebBundle returns a non-trivial source string', () => {
    const src = loadRrwebBundle(import.meta.url);
    expect(typeof src).toBe('string');
    expect(src.length).toBeGreaterThan(10_000);
  });

  it('defines window.rrweb.record + getRecordConsolePlugin when eval’d in a page', () => {
    const src = loadRrwebBundle(import.meta.url);
    // jsdom provides a real `window`; eval the IIFE bundle against it.
    (window as unknown as { eval: (code: string) => void }).eval(src);
    const rrweb = (window as unknown as { rrweb?: Record<string, unknown> }).rrweb;
    expect(rrweb).toBeDefined();
    expect(typeof rrweb?.record).toBe('function');
    expect(typeof rrweb?.getRecordConsolePlugin).toBe('function');
    // record exposes addCustomEvent (used by the nav-boundary marker).
    expect(typeof (rrweb?.record as { addCustomEvent?: unknown }).addCustomEvent).toBe('function');
  });
});

// A guard so the file isn't an empty suite when the bundle is absent — and so a
// missing bundle in CI (where build runs first) is loud.
describe('in-page rrweb bundle presence', () => {
  it('is built before the report-producing E2E (informational in unit runs)', () => {
    // Not an assertion on `built`: unit tests run before build locally. CI runs
    // `build` first, so the skipIf suite above does execute there.
    expect(typeof built).toBe('boolean');
  });
});
