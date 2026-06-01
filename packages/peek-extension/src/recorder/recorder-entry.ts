/**
 * MAIN-world recorder entry — the source esbuild bundles into the IIFE
 * `rrweb-recorder.js` that the SW injects with
 * `chrome.scripting.executeScript({ world: 'MAIN', injectImmediately: true })`
 * (Task 3.19, P2 PRD §A.2 + §A.10).
 *
 * WHY A SEPARATE esbuild IIFE (not a WXT/Vite entrypoint): MAIN-world scripts
 * run as CLASSIC scripts. Vite (and therefore WXT/CRXJS) emit ES modules and
 * lean on dynamic `import()` + `chrome.runtime.getURL` to load content scripts
 * — neither works in `world: 'MAIN'` (crxjs discussion #643, quoted in §A.2).
 * So this file is compiled by esbuild with `format: 'iife'`, every transitive
 * dependency of `@cubenest/rrweb-core` inlined, into a single self-contained
 * classic script with no `import`/`export`. The WXT `build:done` hook
 * (wxt.config.ts) runs that esbuild step and drops the result in the output
 * dir. The build is asserted IIFE by scripts/assert-recorder-iife.mjs.
 *
 * THREAT MODEL (§H1): this recorder only ever emits via `window.postMessage`
 * from inside this IIFE closure. It installs NO global handle (no
 * `window.peek = …`) the page could grab to read buffered data or re-drive the
 * recorder. The page shares this realm and can observe the patched
 * `fetch`/`XHR`, but cannot reach the recorder's state. Masking happens on the
 * ISOLATED side before anything is persisted.
 *
 * NETWORK CAPTURE (alpha.6, Phase 5 task #72): the manual `window.fetch` +
 * `XMLHttpRequest.prototype.{open,send,setRequestHeader}` wrappers (~140 LOC)
 * that previously lived in this file — along with the helper module they
 * relied on — have been REPLACED by `getRecordNetworkPlugin()` from
 * `@cubenest/rrweb-core`. The plugin emits `EventType.Plugin` events with
 * `data.plugin === 'rrweb/network@1'` through the SAME `emit` callback rrweb
 * uses for DOM/console events; the ISOLATED relay forwards them in the
 * `recorder.events` channel, and the SW synthesizes legacy `NetMessage`
 * envelopes for `network.append` (see `background/network-plugin-synth.ts`)
 * so peek-mcp's `network_events` table + the `get_session_network_errors` MCP
 * tool keep working unchanged. The plugin's PerformanceObserver path also
 * captures static-asset + navigation timings the old wrappers missed.
 */

import { getRecordConsolePlugin, getRecordNetworkPlugin, record } from '@cubenest/rrweb-core';
import { PEEK_RRWEB_SOURCE } from './messages.js';

// --- Recorder/relay handshake constants -------------------------------------
// The ISOLATED relay and MAIN recorder both run at document_start in different
// execution contexts; if the recorder emits before the relay's message listener
// attaches, the initial Meta + FullSnapshot are lost and the session becomes
// unreconstructable. We buffer events until the relay signals ready.
const RELAY_PROBE_INTERVAL_MS = 50;
// Hard upper bound: if the relay never responds, fail OPEN at this many ms so
// recording continues (matches pre-handshake behavior). 5 s is enough for any
// realistic content-script attach delay and small enough that the user doesn't
// silently miss capture if the relay is genuinely broken.
const RELAY_READY_TIMEOUT_MS = 5_000;
// Cap on buffered events while waiting for ready. A typical FullSnapshot is
// one event; incrementals queue at most ~5/100ms. Cap protects against a
// pathological "relay never attaches" case from growing memory unboundedly.
const RELAY_BUFFER_CAP = 5_000;

// Re-injected on every navigation; keep it idempotent so a double-inject (a
// racing executeScript into the same realm) never double-patches fetch/XHR or
// starts two recorders. The guard must survive ACROSS separate injections (each
// is a fresh script execution → a fresh closure), so a closure boolean alone is
// insufficient — it must be realm-persistent. We anchor it on `window` but
// define it NON-CONFIGURABLE / NON-WRITABLE so a hostile page can't `delete` or
// overwrite it to force double-injection (review issue 5).
const GUARD = '__peekRecorderInstalled';

(function installPeekRecorder(): void {
  const w = window as unknown as Record<string, unknown>;
  if (w[GUARD] === true) return;
  try {
    Object.defineProperty(window, GUARD, {
      value: true,
      configurable: false,
      writable: false,
      enumerable: false,
    });
  } catch {
    // If the property already exists non-configurable (shouldn't, given the
    // check above) defineProperty throws — treat as "already installed".
    return;
  }

  // The ONLY escape hatch from this closure. A private function, never exposed
  // on `window` — the page cannot intercept buffered events through a global.
  //
  // ATTACH-RACE GUARD (Bug 2, pre-alpha.7 sessions like s_d37f7982): the
  // ISOLATED relay's `addEventListener('message')` may not be registered at
  // the moment rrweb's `record()` emits its initial Meta + FullSnapshot.
  // Buffer all emits until the relay sends `kind: 'relay-ready'`; drain in
  // order then. Fail-open after RELAY_READY_TIMEOUT_MS so a broken relay
  // doesn't silence the session entirely (matches the pre-fix behavior).
  let relayReady = false;
  const earlyBuffer: unknown[] = [];

  const flushBuffer = (): void => {
    for (const payload of earlyBuffer) {
      try {
        window.postMessage({ source: PEEK_RRWEB_SOURCE, payload }, '*');
      } catch {
        // structured-clone failure — drop and continue, do not break the page.
      }
    }
    earlyBuffer.length = 0;
  };

  const postRrweb = (payload: unknown): void => {
    if (!relayReady) {
      if (earlyBuffer.length < RELAY_BUFFER_CAP) earlyBuffer.push(payload);
      // At the cap we silently drop overflow; preserves bounded memory in the
      // (rare) case of a never-attaching relay. The fail-open timer ensures
      // we don't sit here forever — see below.
      return;
    }
    try {
      window.postMessage({ source: PEEK_RRWEB_SOURCE, payload }, '*');
    } catch {
      // postMessage can throw on structured-clone failures; drop the event
      // rather than break the page.
    }
  };

  // Listen for the relay's `relay-ready` signal. The relay broadcasts this on
  // attach AND in response to any `recorder-probe` we send.
  const onHandshake = (ev: MessageEvent): void => {
    if (ev.source !== window) return;
    const data: unknown = ev.data;
    if (typeof data !== 'object' || data === null) return;
    const tagged = data as { source?: unknown; kind?: unknown };
    if (tagged.source !== PEEK_RRWEB_SOURCE) return;
    if (tagged.kind !== 'relay-ready') return;
    if (relayReady) return;
    relayReady = true;
    window.removeEventListener('message', onHandshake);
    flushBuffer();
  };
  window.addEventListener('message', onHandshake);

  // Probe the relay repeatedly until we see `relay-ready`. The relay attaches
  // synchronously in its own main(); if it loaded first, the first probe is
  // enough. If the recorder loaded first, we re-probe every 50 ms — when the
  // relay's listener attaches, the next probe lands in its `onMessage` handler
  // and triggers a `relay-ready` reply.
  const probe = (): void => {
    if (relayReady) return;
    try {
      window.postMessage({ source: PEEK_RRWEB_SOURCE, kind: 'recorder-probe' }, '*');
    } catch {
      // ignore — fail-open timer covers the worst case
    }
  };
  probe();
  const probeTimer = setInterval(() => {
    if (relayReady) {
      clearInterval(probeTimer);
      return;
    }
    probe();
  }, RELAY_PROBE_INTERVAL_MS);

  // Hard ceiling: if the relay is broken / never responds, fail open so the
  // recorder still emits going forward. Matches pre-handshake behavior — the
  // initial events are still lost in that pathological case, which is no
  // worse than what alpha.7+ does today, and the next `checkoutEveryNms`
  // FullSnapshot (≤120 s later) restores a reconstruction anchor.
  setTimeout(() => {
    if (relayReady) return;
    relayReady = true;
    clearInterval(probeTimer);
    window.removeEventListener('message', onHandshake);
    flushBuffer();
  }, RELAY_READY_TIMEOUT_MS);

  // --- rrweb DOM + console + network recording --------------------------
  // record() returns a stop fn; we deliberately keep no handle (the page could
  // not reach it anyway from inside this closure) — the recorder stops when the
  // page unloads. `emit` posts each event to the ISOLATED relay.
  //
  // Checkout cadence (J.6, 2026-05-28 QA walk): rrweb's default is to emit ONE
  // FullSnapshot at recording start, then only IncrementalSnapshots forever.
  // For a long-running session (the AI-coding-agent flow: open tab, fight with
  // the app for 5+ minutes, then ask Claude what just happened) the only
  // FullSnapshot is hundreds of MB of incrementals back — and the MCP
  // `get_dom_snapshot` tool, which walks forward from the nearest FullSnapshot
  // at/before the error timestamp, then returns "no snapshot at or before the
  // error" or a many-second reconstruction. `checkoutEveryNms` makes rrweb
  // emit a fresh FullSnapshot on a cadence so the look-back window is bounded.
  //
  // Trade-off: each checkout is a full serialized DOM (~10-100 KB on typical
  // pages, MB-class on heavy SPAs) — so a 2 min cadence on a 30 min session
  // adds ~15 extra FullSnapshots, well under the 25 MB session ceiling we
  // already enforce upstream. 2 min is the sweet spot between disk cost and
  // AI-tool responsiveness: an error fired at t=29 min reconstructs from a
  // FullSnapshot at most 2 min stale, which is the user-perceived bound on
  // "the DOM at the time of the bug".
  //
  // `checkoutEveryN: 5000` is the secondary trigger — for bursty-mutation
  // pages (a heavy infinite-scroll feed, a webgl canvas re-render loop) where
  // 2 minutes of events could be 100k+ entries. Whichever fires first.
  try {
    record({
      emit: (event: unknown) => postRrweb(event),
      // Open-shadow-root recording is handled by the rrweb fork; closed roots
      // are picked up best-effort by the ISOLATED relay (Task 3.21).
      recordCanvas: false,
      collectFonts: false,
      // J.6: bound the look-back window for get_dom_snapshot. See the comment
      // above for the rationale + trade-off.
      checkoutEveryNms: 120_000,
      checkoutEveryN: 5000,
      plugins: [
        // Capture console as rrweb plugin events so the relay/native host can
        // extract console_events without a second channel.
        getRecordConsolePlugin(),
        // Framework-agnostic network capture (alpha.6, Phase 5 task #72).
        // Defaults are PostHog-conservative + match peek's privacy posture:
        //   - recordHeaders: false  — headers carry auth tokens/cookies
        //   - recordBody:    false  — bodies carry PII; rely on Deep capture
        //                              (chrome.debugger) for opt-in body capture
        //   - recordInitialRequests + capturePerformance: true — the
        //     PerformanceObserver path picks up page-load resources + the
        //     navigation entry the legacy wrappers missed
        // The plugin's DEFAULT maskRequestFn already pipes through
        // @cubenest/rrweb-core's redactBody / redactNetworkHeaders / URL-
        // redaction, so we omit it here and inherit the defense-in-depth mask.
        getRecordNetworkPlugin({
          recordHeaders: false,
          recordBody: false,
          recordInitialRequests: true,
          capturePerformance: true,
        }),
      ],
    } as Parameters<typeof record>[0]);
  } catch (err) {
    postRrweb({ __peekError: 'record_init_failed', detail: String(err) });
  }
})();
