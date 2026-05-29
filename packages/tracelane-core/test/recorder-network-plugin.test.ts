import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BrowserExecutor } from '../src/browser-executor';
import { createRecorder } from '../src/recorder';

/**
 * The Phase 5 network-plugin passthrough — verified at the recorder layer.
 *
 * The recorder owns the in-page init invocation: it forwards
 * `networkPluginOptions` into `tracelaneInitScript`, which (when both the
 * options and a `getRecordNetworkPlugin` factory are present on
 * `window.rrweb`) registers the framework-agnostic network plugin alongside
 * the console plugin. These tests use a fake executor (mirroring
 * `recorder-drain.test.ts`'s pattern) so we can assert the plugins-array
 * shape `record()` was called with.
 */

interface RecordedRrwebCall {
  plugins: unknown[];
}

function createFakeExecutor() {
  const win: Record<string, unknown> = {};
  const recordedCalls: RecordedRrwebCall[] = [];

  win.eval = (code: string) => {
    // biome-ignore lint/security/noGlobalEval: test shim simulating page-context eval.
    eval(code);
  };

  const executor: BrowserExecutor = {
    execute: vi.fn(async <T>(fn: (...args: unknown[]) => T, ...args: unknown[]): Promise<T> => {
      const prev = (globalThis as { window?: unknown }).window;
      (globalThis as { window?: unknown }).window = win;
      try {
        return fn(...args);
      } finally {
        (globalThis as { window?: unknown }).window = prev;
      }
    }),
    executeAsync: vi.fn(async <T>(): Promise<T> => undefined as T),
    cdp: vi.fn(async () => undefined),
    on: vi.fn(),
  };

  return { executor, win, recordedCalls };
}

/**
 * A fake bundle that defines `window.rrweb` with `record`, the console
 * plugin factory, AND the network plugin factory. `record` stashes the
 * `plugins` arg into a globally accessible list so the tests can assert
 * what got registered.
 */
const FAKE_BUNDLE = `
  window.__recordedRrwebCalls = [];
  window.rrweb = {
    record: Object.assign(
      function (opts) {
        window.__recordedRrwebCalls.push({ plugins: opts.plugins });
        return function stop() {};
      },
      { addCustomEvent: function () {} },
    ),
    getRecordConsolePlugin: function () { return { name: 'console-plugin', kind: 'console' }; },
    getRecordNetworkPlugin: function (opts) {
      return { name: 'network-plugin', kind: 'network', opts: opts };
    },
  };
`;

/**
 * Equivalent bundle with NO `getRecordNetworkPlugin` — exercises the
 * graceful-degrade path (older substrate, before the network plugin).
 */
const FAKE_BUNDLE_NO_NETWORK = `
  window.__recordedRrwebCalls = [];
  window.rrweb = {
    record: Object.assign(
      function (opts) {
        window.__recordedRrwebCalls.push({ plugins: opts.plugins });
        return function stop() {};
      },
      { addCustomEvent: function () {} },
    ),
    getRecordConsolePlugin: function () { return { name: 'console-plugin', kind: 'console' }; },
  };
`;

function pluginsFromLastRecordCall(win: Record<string, unknown>): unknown[] | undefined {
  const calls = win.__recordedRrwebCalls as RecordedRrwebCall[] | undefined;
  return calls?.[calls.length - 1]?.plugins;
}

describe('recorder: network-plugin passthrough (Phase 5)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('omits the network plugin when networkPluginOptions is undefined (default)', async () => {
    const { executor, win } = createFakeExecutor();
    const recorder = createRecorder({ executor, rrwebBundle: FAKE_BUNDLE });
    await recorder.start();
    const plugins = pluginsFromLastRecordCall(win);
    expect(plugins).toHaveLength(1);
    expect((plugins?.[0] as { kind: string }).kind).toBe('console');
  });

  it('registers the network plugin alongside console when networkPluginOptions is set', async () => {
    const { executor, win } = createFakeExecutor();
    const recorder = createRecorder({
      executor,
      rrwebBundle: FAKE_BUNDLE,
      networkPluginOptions: {},
    });
    await recorder.start();
    const plugins = pluginsFromLastRecordCall(win);
    expect(plugins).toHaveLength(2);
    expect((plugins?.[0] as { kind: string }).kind).toBe('console');
    expect((plugins?.[1] as { kind: string }).kind).toBe('network');
  });

  it('forwards a non-empty networkPluginOptions object verbatim to getRecordNetworkPlugin', async () => {
    const { executor, win } = createFakeExecutor();
    const custom = { recordHeaders: true, payloadHostDenyList: ['x.example'] };
    const recorder = createRecorder({
      executor,
      rrwebBundle: FAKE_BUNDLE,
      networkPluginOptions: custom,
    });
    await recorder.start();
    const plugins = pluginsFromLastRecordCall(win);
    const networkPlugin = plugins?.[1] as { kind: string; opts: unknown };
    expect(networkPlugin?.kind).toBe('network');
    expect(networkPlugin?.opts).toEqual(custom);
  });

  it('silently skips the network plugin when the bundle has no getRecordNetworkPlugin (older substrate)', async () => {
    const { executor, win } = createFakeExecutor();
    const recorder = createRecorder({
      executor,
      rrwebBundle: FAKE_BUNDLE_NO_NETWORK,
      networkPluginOptions: { recordHeaders: true },
    });
    await recorder.start();
    const plugins = pluginsFromLastRecordCall(win);
    // The plugin is gracefully omitted; only the console plugin is registered.
    expect(plugins).toHaveLength(1);
    expect((plugins?.[0] as { kind: string }).kind).toBe('console');
  });
});
