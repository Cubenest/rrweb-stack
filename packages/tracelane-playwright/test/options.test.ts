import { describe, expect, it } from 'vitest';
import { DEFAULT_OUT_DIR, resolveOptions } from '../src/options.js';

// resolveOptions normalizes user options into a fully-resolved shape the
// session consumes, applying defaults (failed mode, ./tracelane-reports,
// network capture on) and honoring the TRACELANE_MODE / TRACELANE_OUT_DIR /
// TRACELANE_CAPTURE_NETWORK env overrides (same env contract as @tracelane/wdio
// + @tracelane/core). The reporter bridges captureNetwork (and mode/outDir) to
// these env vars at startup so the fixture receives them; an explicit env var
// always wins over the reporter option.

describe('resolveOptions', () => {
  it('applies defaults for an empty options object (no env)', () => {
    expect(resolveOptions({}, {})).toEqual({
      mode: 'failed',
      outDir: DEFAULT_OUT_DIR,
      captureNetwork: true,
    });
  });

  it('respects explicit options', () => {
    expect(resolveOptions({ mode: 'all', outDir: '/tmp/r', captureNetwork: false }, {})).toEqual({
      mode: 'all',
      outDir: '/tmp/r',
      captureNetwork: false,
    });
  });

  it('TRACELANE_MODE env overrides mode', () => {
    expect(resolveOptions({}, { TRACELANE_MODE: 'all' }).mode).toBe('all');
    // explicit option is also overridden by the env (env wins, matching core's resolveMode)
    expect(resolveOptions({ mode: 'failed' }, { TRACELANE_MODE: 'all' }).mode).toBe('all');
  });

  it('TRACELANE_OUT_DIR env overrides outDir', () => {
    expect(resolveOptions({}, { TRACELANE_OUT_DIR: '/env/out' }).outDir).toBe('/env/out');
    expect(resolveOptions({ outDir: './local' }, { TRACELANE_OUT_DIR: '/env/out' }).outDir).toBe(
      '/env/out',
    );
  });

  it('ignores an invalid TRACELANE_MODE and keeps the configured/default mode', () => {
    expect(resolveOptions({}, { TRACELANE_MODE: 'bogus' }).mode).toBe('failed');
    expect(resolveOptions({ mode: 'all' }, { TRACELANE_MODE: 'bogus' }).mode).toBe('all');
  });

  it('TRACELANE_CAPTURE_NETWORK=false disables CDP capture (case-insensitive)', () => {
    // The reporter bridges captureNetwork to this env var; an explicit env var wins.
    expect(resolveOptions({}, { TRACELANE_CAPTURE_NETWORK: 'false' }).captureNetwork).toBe(false);
    expect(resolveOptions({}, { TRACELANE_CAPTURE_NETWORK: 'False' }).captureNetwork).toBe(false);
    expect(resolveOptions({}, { TRACELANE_CAPTURE_NETWORK: 'FALSE' }).captureNetwork).toBe(false);
    // Any value other than 'false' (case-insensitive) keeps capture enabled
    expect(resolveOptions({}, { TRACELANE_CAPTURE_NETWORK: 'true' }).captureNetwork).toBe(true);
    expect(resolveOptions({}, { TRACELANE_CAPTURE_NETWORK: '1' }).captureNetwork).toBe(true);
    // opts.captureNetwork is still honored when the env var is absent
    expect(resolveOptions({ captureNetwork: false }, {}).captureNetwork).toBe(false);
    // env var wins over opts when both are set
    expect(
      resolveOptions({ captureNetwork: true }, { TRACELANE_CAPTURE_NETWORK: 'false' })
        .captureNetwork,
    ).toBe(false);
  });
});
