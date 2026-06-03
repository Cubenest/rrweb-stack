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
 * Network-plugin options forwarded into the in-page rrweb network plugin.
 *
 * Typed as `unknown`-shaped here so `@tracelane/core` doesn't have to mirror
 * the substrate's full type surface (those types live in `@cubenest/rrweb-core`
 * and the adapter — `@tracelane/wdio` — is what types the user-facing
 * passthrough). The init script forwards the value verbatim to
 * `window.rrweb.getRecordNetworkPlugin(options)`.
 */
export type NetworkPluginOptions = Record<string, unknown>;

/**
 * The in-page init routine (PRD §D.3 + ADR-0006). Idempotent across calls via a
 * monotonic `__tracelane__sessionId` stamp and a cooldown guard so hash-only /
 * HMR navigations don't double-init the recorder (the cooldown / re-injection
 * semantics are exercised in Task 2.4).
 *
 * Assumes `window.rrweb` is already defined (the recorder injects the rrweb
 * bundle string first). Returns the active session id so the Node side can
 * confirm whether a (re-)init actually took effect.
 *
 * `networkOptions === undefined` keeps the network plugin OFF (the legacy
 * CDP-based path still applies). `networkOptions === {}` opts in with the
 * plugin's defaults; any other object is forwarded verbatim. The plugin is
 * only registered when `window.rrweb.getRecordNetworkPlugin` is present — so
 * older bundles that pre-date the network-plugin export silently skip it.
 */
export function tracelaneInitScript(
  cooldownMs: number,
  consoleOptions: ConsolePluginOptions,
  networkOptions?: NetworkPluginOptions,
): number {
  const w = window as unknown as {
    rrweb?: {
      record: ((opts: unknown) => unknown) & {
        addCustomEvent?: (tag: string, payload: unknown) => void;
      };
      getRecordConsolePlugin: (opts: unknown) => unknown;
      getRecordNetworkPlugin?: (opts: unknown) => unknown;
    };
    sessionStorage?: {
      getItem(k: string): string | null;
      setItem(k: string, v: string): void;
      removeItem(k: string): void;
    };
    addEventListener?: (type: string, cb: () => void) => void;
    __tracelane__events?: unknown[];
    __tracelane__inited?: number;
    __tracelane__sessionId?: number;
    __tracelane__stop?: (() => void) | undefined;
    __tracelane__pagehideBound?: boolean;
  };

  const now = Date.now();
  // Cooldown: a very recent init means this is a hash/HMR re-render, not a real
  // navigation — skip to avoid double-recording (ADR-0006). Return the `0`
  // sentinel so the Node side can tell "suppressed" apart from a fresh recording
  // (the in-page session id resets to 1 on every new document, so it can't be
  // used as a monotonic signal across hard navigations).
  if (w.__tracelane__inited !== undefined && now - w.__tracelane__inited < cooldownMs) {
    return 0;
  }

  w.__tracelane__inited = now;
  w.__tracelane__sessionId = (w.__tracelane__sessionId ?? 0) + 1;
  w.__tracelane__events = w.__tracelane__events ?? [];

  // Pre-navigation rescue (Fix #2): the in-page event buffer dies on a hard
  // navigation before the Node poll drains it. The OLD document stashes its
  // unflushed tail into sessionStorage on `pagehide`; this fresh document merges
  // it back in on init, then clears the key so it's consumed exactly once.
  // Best-effort: sessionStorage may be unavailable (private mode) or the value
  // may be malformed — never let that break recording.
  try {
    const pending = w.sessionStorage?.getItem('__tracelane__pending');
    if (pending) {
      const parsed = JSON.parse(pending) as unknown;
      if (Array.isArray(parsed) && parsed.length > 0) {
        (w.__tracelane__events as unknown[]).push(...parsed);
      }
      w.sessionStorage?.removeItem('__tracelane__pending');
    }
  } catch {
    // sessionStorage unavailable / parse failure — best-effort, ignore.
  }

  // Register the `pagehide` flush once per document. On teardown it stashes the
  // live buffer (only post-last-drain events remain, since drain read-and-clears)
  // into sessionStorage so the next document can merge it.
  if (w.__tracelane__pagehideBound !== true && typeof w.addEventListener === 'function') {
    w.__tracelane__pagehideBound = true;
    w.addEventListener('pagehide', () => {
      try {
        const events = w.__tracelane__events ?? [];
        if (events.length === 0) return;
        const json = JSON.stringify(events);
        // Size guard: sessionStorage quota is ~5 MB; bail well under it rather
        // than throw a QuotaExceededError mid-teardown.
        if (json.length > 4_000_000) return;
        w.sessionStorage?.setItem('__tracelane__pending', json);
      } catch {
        // private mode / quota / serialization failure — best-effort, ignore.
      }
    });
  }

  if (w.rrweb !== undefined) {
    // Tear down any prior recorder before starting a fresh one (re-injection).
    if (typeof w.__tracelane__stop === 'function') {
      try {
        w.__tracelane__stop();
      } catch {
        // ignore teardown errors from a destroyed page context
      }
    }
    const plugins: unknown[] = [w.rrweb.getRecordConsolePlugin(consoleOptions)];
    if (networkOptions !== undefined && typeof w.rrweb.getRecordNetworkPlugin === 'function') {
      // Framework-agnostic network capture (replaces the CDP path for users on
      // the in-page recorder). Emits EventType.Plugin events with
      // `data.plugin === 'rrweb/network@1'`.
      plugins.push(w.rrweb.getRecordNetworkPlugin(networkOptions));
    }
    const stop = w.rrweb.record({
      emit(event: unknown) {
        // Never call console.* here — the console plugin patches console and
        // guards recursion (PRD §D.4).
        (w.__tracelane__events as unknown[]).push(event);
      },
      plugins,
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
