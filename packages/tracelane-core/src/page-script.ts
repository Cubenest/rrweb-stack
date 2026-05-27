/**
 * Page-context scripts, written as self-contained functions so a
 * {@link BrowserExecutor} can `.toString()`-serialize and run them in the
 * browser (PRD §A.4). They MUST NOT close over any Node-side variable — every
 * input arrives via an explicit argument, every output is JSON-serializable.
 *
 * The recorder controller (Node side) is the only caller; these are kept in a
 * separate module so the serialized source stays small and reviewable.
 */

/** Options forwarded into the in-page rrweb console plugin (PRD §D.3). */
export interface ConsolePluginOptions {
  level?: string[];
  lengthThreshold?: number;
  stringifyOptions?: {
    stringLengthLimit?: number;
    numOfKeysLimit?: number;
    depthOfLimit?: number;
  };
}

/** Console-plugin defaults from PRD §D.3. */
export const DEFAULT_CONSOLE_PLUGIN_OPTIONS: ConsolePluginOptions = {
  level: ['info', 'log', 'warn', 'error'],
  lengthThreshold: 10000,
  stringifyOptions: { stringLengthLimit: 1000, numOfKeysLimit: 100, depthOfLimit: 1 },
};

/**
 * The in-page init routine (PRD §D.3 + ADR-0006). Idempotent across calls via a
 * monotonic `__tracelane__sessionId` stamp and a cooldown guard so hash-only /
 * HMR navigations don't double-init the recorder (the cooldown / re-injection
 * semantics are exercised in Task 2.4).
 *
 * Assumes `window.rrweb` is already defined (the recorder injects the rrweb
 * bundle string first). Returns the active session id so the Node side can
 * confirm whether a (re-)init actually took effect.
 */
export function tracelaneInitScript(
  cooldownMs: number,
  consoleOptions: ConsolePluginOptions,
): number {
  const w = window as unknown as {
    rrweb?: {
      record: ((opts: unknown) => unknown) & {
        addCustomEvent?: (tag: string, payload: unknown) => void;
      };
      getRecordConsolePlugin: (opts: unknown) => unknown;
    };
    __tracelane__events?: unknown[];
    __tracelane__inited?: number;
    __tracelane__sessionId?: number;
    __tracelane__stop?: (() => void) | undefined;
  };

  const now = Date.now();
  // Cooldown: a very recent init means this is a hash/HMR re-render, not a real
  // navigation — skip to avoid double-recording (ADR-0006).
  if (w.__tracelane__inited !== undefined && now - w.__tracelane__inited < cooldownMs) {
    return w.__tracelane__sessionId ?? 0;
  }

  w.__tracelane__inited = now;
  w.__tracelane__sessionId = (w.__tracelane__sessionId ?? 0) + 1;
  w.__tracelane__events = w.__tracelane__events ?? [];

  if (w.rrweb !== undefined) {
    // Tear down any prior recorder before starting a fresh one (re-injection).
    if (typeof w.__tracelane__stop === 'function') {
      try {
        w.__tracelane__stop();
      } catch {
        // ignore teardown errors from a destroyed page context
      }
    }
    const stop = w.rrweb.record({
      emit(event: unknown) {
        // Never call console.* here — the console plugin patches console and
        // guards recursion (PRD §D.4).
        (w.__tracelane__events as unknown[]).push(event);
      },
      plugins: [w.rrweb.getRecordConsolePlugin(consoleOptions)],
    });
    w.__tracelane__stop = typeof stop === 'function' ? (stop as () => void) : undefined;
  }

  return w.__tracelane__sessionId;
}

/**
 * Read-and-clear drain (PRD §A.4 / §D.3). Returns the buffered events and resets
 * the page buffer so the next drain doesn't double-count.
 */
export function tracelaneDrainScript(): unknown[] {
  const w = window as unknown as { __tracelane__events?: unknown[] };
  const out = w.__tracelane__events ?? [];
  w.__tracelane__events = [];
  return out;
}

/**
 * Append a `tracelane.nav` boundary marker (ADR-0006 / PRD §D.5) via rrweb's
 * canonical custom-event API so the merged stream still has a navigation marker
 * the player can render. No-op if rrweb isn't present.
 */
export function tracelaneNavScript(url: string, ts: number): void {
  const w = window as unknown as {
    rrweb?: { record?: { addCustomEvent?: (tag: string, payload: unknown) => void } };
  };
  w.rrweb?.record?.addCustomEvent?.('tracelane.nav', { url, ts });
}
