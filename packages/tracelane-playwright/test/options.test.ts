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
      captureRrweb: true,
      captureConsole: true,
      security: true,
      footer: true,
    });
  });

  it('respects explicit options', () => {
    expect(resolveOptions({ mode: 'all', outDir: '/tmp/r', captureNetwork: false }, {})).toEqual({
      mode: 'all',
      outDir: '/tmp/r',
      captureNetwork: false,
      captureRrweb: true,
      captureConsole: true,
      security: true,
      footer: true,
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

  describe('Gap 1 — security', () => {
    it('defaults security to true', () => {
      expect(resolveOptions({}, {}).security).toBe(true);
    });

    it('honors security:false', () => {
      expect(resolveOptions({ security: false }, {}).security).toBe(false);
    });

    it('TRACELANE_SECURITY=false disables (case-insensitive); env wins over opts', () => {
      expect(resolveOptions({}, { TRACELANE_SECURITY: 'false' }).security).toBe(false);
      expect(resolveOptions({}, { TRACELANE_SECURITY: 'False' }).security).toBe(false);
      expect(resolveOptions({}, { TRACELANE_SECURITY: 'FALSE' }).security).toBe(false);
      expect(resolveOptions({}, { TRACELANE_SECURITY: 'true' }).security).toBe(true);
      expect(resolveOptions({ security: true }, { TRACELANE_SECURITY: 'false' }).security).toBe(
        false,
      );
      expect(resolveOptions({ security: false }, { TRACELANE_SECURITY: 'true' }).security).toBe(
        true,
      );
    });
  });

  describe('Gap 2 — capture channels + masking', () => {
    it('captureRrweb / captureConsole default true', () => {
      const r = resolveOptions({}, {});
      expect(r.captureRrweb).toBe(true);
      expect(r.captureConsole).toBe(true);
    });

    it('capture.rrweb / capture.console false flips the resolved channels', () => {
      const r = resolveOptions({ capture: { rrweb: false, console: false } }, {});
      expect(r.captureRrweb).toBe(false);
      expect(r.captureConsole).toBe(false);
    });

    it('TRACELANE_CAPTURE_RRWEB / TRACELANE_CAPTURE_CONSOLE=false disable (env wins)', () => {
      expect(resolveOptions({}, { TRACELANE_CAPTURE_RRWEB: 'false' }).captureRrweb).toBe(false);
      expect(resolveOptions({}, { TRACELANE_CAPTURE_RRWEB: 'False' }).captureRrweb).toBe(false);
      expect(resolveOptions({}, { TRACELANE_CAPTURE_CONSOLE: 'false' }).captureConsole).toBe(false);
      expect(
        resolveOptions({ capture: { rrweb: true } }, { TRACELANE_CAPTURE_RRWEB: 'false' })
          .captureRrweb,
      ).toBe(false);
      expect(
        resolveOptions({ capture: { rrweb: false } }, { TRACELANE_CAPTURE_RRWEB: 'true' })
          .captureRrweb,
      ).toBe(true);
    });

    it('network-on prefers capture.network over the legacy captureNetwork', () => {
      // capture.network wins over the deprecated top-level captureNetwork.
      expect(
        resolveOptions({ capture: { network: false }, captureNetwork: true }, {}).captureNetwork,
      ).toBe(false);
      expect(
        resolveOptions({ capture: { network: true }, captureNetwork: false }, {}).captureNetwork,
      ).toBe(true);
      // legacy captureNetwork still works when capture.network is unset.
      expect(resolveOptions({ captureNetwork: false }, {}).captureNetwork).toBe(false);
      // env TRACELANE_CAPTURE_NETWORK still wins over both.
      expect(
        resolveOptions({ capture: { network: true } }, { TRACELANE_CAPTURE_NETWORK: 'false' })
          .captureNetwork,
      ).toBe(false);
    });

    it('forwards capture.networkOptions verbatim', () => {
      const networkOptions = { recordHeaders: true, payloadHostDenyList: ['x.test'] };
      expect(resolveOptions({ capture: { networkOptions } }, {}).networkOptions).toEqual(
        networkOptions,
      );
    });

    it('forwards consolePluginOptions verbatim', () => {
      const consolePluginOptions = { level: ['error'] as never };
      expect(resolveOptions({ consolePluginOptions }, {}).consolePluginOptions).toEqual(
        consolePluginOptions,
      );
    });

    it('TRACELANE_NETWORK_OPTIONS / TRACELANE_CONSOLE_OPTIONS parse JSON (and win over opts)', () => {
      const r = resolveOptions(
        {},
        {
          TRACELANE_NETWORK_OPTIONS: JSON.stringify({ recordBody: true }),
          TRACELANE_CONSOLE_OPTIONS: JSON.stringify({ level: ['warn'] }),
        },
      );
      expect(r.networkOptions).toEqual({ recordBody: true });
      expect(r.consolePluginOptions).toEqual({ level: ['warn'] });
    });

    it('malformed TRACELANE_NETWORK_OPTIONS / TRACELANE_CONSOLE_OPTIONS degrade to undefined', () => {
      const r = resolveOptions(
        {},
        { TRACELANE_NETWORK_OPTIONS: '{not json', TRACELANE_CONSOLE_OPTIONS: '{also bad' },
      );
      expect(r.networkOptions).toBeUndefined();
      expect(r.consolePluginOptions).toBeUndefined();
    });
  });

  describe('Gap 3 — footer + drain/cooldown', () => {
    it('footer defaults true; report.footer:false disables', () => {
      expect(resolveOptions({}, {}).footer).toBe(true);
      expect(resolveOptions({ report: { footer: false } }, {}).footer).toBe(false);
    });

    it('TRACELANE_FOOTER=false disables (env wins)', () => {
      expect(resolveOptions({}, { TRACELANE_FOOTER: 'false' }).footer).toBe(false);
      expect(
        resolveOptions({ report: { footer: true } }, { TRACELANE_FOOTER: 'false' }).footer,
      ).toBe(false);
    });

    it('drainIntervalMs / cooldownMs are forwarded; undefined when unset', () => {
      expect(resolveOptions({}, {}).drainIntervalMs).toBeUndefined();
      expect(resolveOptions({}, {}).cooldownMs).toBeUndefined();
      expect(resolveOptions({ drainIntervalMs: 800, cooldownMs: 300 }, {})).toMatchObject({
        drainIntervalMs: 800,
        cooldownMs: 300,
      });
    });

    it('TRACELANE_DRAIN_INTERVAL_MS / TRACELANE_COOLDOWN_MS parse ints (env wins; NaN ignored)', () => {
      expect(resolveOptions({}, { TRACELANE_DRAIN_INTERVAL_MS: '900' }).drainIntervalMs).toBe(900);
      expect(resolveOptions({}, { TRACELANE_COOLDOWN_MS: '400' }).cooldownMs).toBe(400);
      expect(
        resolveOptions({ drainIntervalMs: 500 }, { TRACELANE_DRAIN_INTERVAL_MS: '900' })
          .drainIntervalMs,
      ).toBe(900);
      // NaN env values are ignored, falling back to the option/default.
      expect(resolveOptions({ cooldownMs: 250 }, { TRACELANE_COOLDOWN_MS: 'abc' }).cooldownMs).toBe(
        250,
      );
    });
  });
});
