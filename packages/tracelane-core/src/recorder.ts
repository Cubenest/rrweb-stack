import type { eventWithTime } from '@cubenest/rrweb-core';
import type { BrowserExecutor } from './browser-executor.js';
import { type Mode, resolveMode } from './mode.js';
import {
  type ConsolePluginOptions,
  DEFAULT_CONSOLE_PLUGIN_OPTIONS,
  type NetworkPluginOptions,
  tracelaneDrainScript,
  tracelaneInitScript,
  tracelaneNavScript,
} from './page-script.js';

/** Default re-injection cooldown in ms (ADR-0006). */
export const DEFAULT_COOLDOWN_MS = 250;
/** Default Node-side poll interval in ms (ADR-0006). */
export const DEFAULT_DRAIN_INTERVAL_MS = 5000;

export interface RecorderOptions {
  /** The framework-agnostic driver (ADR-0004). */
  executor: BrowserExecutor;
  /**
   * The rrweb UMD bundle source that defines `window.rrweb` (with `record` and
   * `getRecordConsolePlugin`). Supplied by the consuming adapter — `@tracelane/core`
   * is bundle-source-agnostic and never imports rrweb for in-page injection.
   */
  rrwebBundle: string;
  /** Node-side drain poll interval (default 5000). */
  drainIntervalMs?: number;
  /** Re-injection cooldown guard (default 250). */
  cooldownMs?: number;
  /** Options forwarded to the in-page console plugin. */
  consolePluginOptions?: ConsolePluginOptions;
  /**
   * Options forwarded to the in-page rrweb network plugin (`rrweb/network@1`).
   *
   * `undefined` (default) keeps the plugin OFF — the legacy CDP-based capture
   * path stays in charge. Pass an object (even `{}` for plugin defaults) to
   * register the plugin in the in-page recorder. Adapters wire this through
   * from their user-facing options (e.g. `@tracelane/wdio`'s
   * `capture.networkOptions`).
   */
  networkPluginOptions?: NetworkPluginOptions;
  /**
   * Capture mode (ADR-0005). Default `'failed'`. The `TRACELANE_MODE` env var
   * overrides this at {@link Recorder.finalize} time.
   */
  mode?: Mode;
}

/** Outcome handed to {@link Recorder.finalize}. */
export interface TestOutcome {
  /** Whether the test passed. */
  passed: boolean;
}

/** Decision returned by {@link Recorder.finalize}. */
export interface FinalizeResult {
  /** Whether a report should be built for this test (ADR-0005). */
  shouldBuildReport: boolean;
  /** The events to build the report from (empty when discarded). */
  events: eventWithTime[];
}

export interface Recorder {
  /** Inject the rrweb bundle, install the in-page buffer, and start polling. */
  start(): Promise<void>;
  /**
   * Re-inject after a navigation (ADR-0006). The in-page cooldown guard
   * suppresses double-init on hash-only / HMR navigations; when a real re-init
   * takes effect (the monotonic session id advances) a `tracelane.nav` boundary
   * event is appended. Returns `true` if a re-init actually happened.
   */
  reinject(url: string): Promise<boolean>;
  /** Read+clear the page buffer, merge into the Node buffer, return the batch. */
  drain(): Promise<eventWithTime[]>;
  /** Stop polling and perform a final drain. */
  stop(): Promise<void>;
  /**
   * End the capture (ADR-0005): stop polling, drain any pending in-page events,
   * then apply the mode policy. In `'failed'` mode a passing test discards the
   * buffer and reports nothing; a failing test (or `'all'` mode) keeps the
   * buffer and signals that a report should be built. `TRACELANE_MODE` overrides
   * the configured mode here.
   */
  finalize(outcome: TestOutcome): Promise<FinalizeResult>;
  /** The merged Node-side event buffer (live reference). */
  getBuffer(): eventWithTime[];
}

/** Inject + eval the rrweb bundle string in the page (defines `window.rrweb`). */
function injectBundleScript(bundle: string): void {
  // window.eval runs the bundle in global page scope (so `window.rrweb` becomes
  // a real global), which is the intended injection behavior in the page context.
  (window as unknown as { eval: (code: string) => void }).eval(bundle);
}

export function createRecorder(options: RecorderOptions): Recorder {
  const {
    executor,
    rrwebBundle,
    drainIntervalMs = DEFAULT_DRAIN_INTERVAL_MS,
    cooldownMs = DEFAULT_COOLDOWN_MS,
    consolePluginOptions = DEFAULT_CONSOLE_PLUGIN_OPTIONS,
    networkPluginOptions,
    mode: configMode,
  } = options;

  const buffer: eventWithTime[] = [];
  let pollTimer: ReturnType<typeof setInterval> | undefined;
  let started = false;
  // Last session id we've observed from the page; advances only when an init
  // actually takes effect (i.e. wasn't suppressed by the cooldown guard).
  let lastSessionId = 0;

  /** Run the init script in-page and return the active session id. */
  async function runInit(): Promise<number> {
    return executor.execute(
      tracelaneInitScript as (...args: unknown[]) => number,
      cooldownMs,
      consolePluginOptions,
      networkPluginOptions,
    );
  }

  async function inject(): Promise<void> {
    await executor.execute(injectBundleScript as (...args: unknown[]) => void, rrwebBundle);
    lastSessionId = await runInit();
  }

  async function reinject(url: string): Promise<boolean> {
    // Re-eval the bundle (the page may have been torn down by navigation), then
    // re-run init. The cooldown guard inside the init script decides whether a
    // fresh recorder actually starts.
    await executor.execute(injectBundleScript as (...args: unknown[]) => void, rrwebBundle);
    const sessionId = await runInit();
    if (sessionId <= lastSessionId) {
      // Suppressed by cooldown — no navigation boundary to record.
      return false;
    }
    lastSessionId = sessionId;
    await executor.execute(tracelaneNavScript as (...args: unknown[]) => void, url, Date.now());
    return true;
  }

  async function drain(): Promise<eventWithTime[]> {
    const batch = (await executor.execute(
      tracelaneDrainScript as (...args: unknown[]) => unknown[],
    )) as eventWithTime[] | null | undefined;
    if (batch && batch.length > 0) {
      buffer.push(...batch);
      return batch;
    }
    return [];
  }

  async function start(): Promise<void> {
    if (started) return;
    started = true;
    await inject();
    pollTimer = setInterval(() => {
      void drain();
    }, drainIntervalMs);
  }

  async function stop(): Promise<void> {
    if (pollTimer !== undefined) {
      clearInterval(pollTimer);
      pollTimer = undefined;
    }
    started = false;
    await drain();
  }

  async function finalize(outcome: TestOutcome): Promise<FinalizeResult> {
    await stop();
    const mode = resolveMode(configMode);
    const shouldBuildReport = mode === 'all' || !outcome.passed;
    if (!shouldBuildReport) {
      // Discard: passing test in 'failed' mode keeps near-zero artifact cost.
      buffer.length = 0;
      return { shouldBuildReport: false, events: [] };
    }
    return { shouldBuildReport: true, events: buffer };
  }

  return {
    start,
    reinject,
    drain,
    stop,
    finalize,
    getBuffer: () => buffer,
  };
}
