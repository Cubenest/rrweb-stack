import type { eventWithTime } from '@cubenest/rrweb-core';
import type { BrowserExecutor } from './browser-executor';
import {
  type ConsolePluginOptions,
  DEFAULT_CONSOLE_PLUGIN_OPTIONS,
  tracelaneDrainScript,
  tracelaneInitScript,
} from './page-script';

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
}

export interface Recorder {
  /** Inject the rrweb bundle, install the in-page buffer, and start polling. */
  start(): Promise<void>;
  /** Read+clear the page buffer, merge into the Node buffer, return the batch. */
  drain(): Promise<eventWithTime[]>;
  /** Stop polling and perform a final drain. */
  stop(): Promise<void>;
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
  } = options;

  const buffer: eventWithTime[] = [];
  let pollTimer: ReturnType<typeof setInterval> | undefined;
  let started = false;

  async function inject(): Promise<void> {
    await executor.execute(injectBundleScript as (...args: unknown[]) => void, rrwebBundle);
    await executor.execute(
      tracelaneInitScript as (...args: unknown[]) => number,
      cooldownMs,
      consolePluginOptions,
    );
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

  return {
    start,
    drain,
    stop,
    getBuffer: () => buffer,
  };
}
