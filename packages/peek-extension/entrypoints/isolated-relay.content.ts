import { defineContentScript } from 'wxt/utils/define-content-script';
import {
  type Cmd,
  type RelayConsoleEvent,
  type ShadowReport,
  sendCmd,
} from '../src/messaging/protocol';
import {
  type NetMessage,
  type PeekMessage,
  isNetMessage,
  isPeekMessage,
  isRrwebMessage,
} from '../src/recorder/messages';
import { EventBatcher } from '../src/relay/batch';
import { extractConsoleEvent } from '../src/relay/console-extract';
import { maskNetMessage } from '../src/relay/mask';
import { collectShadowReports, getOpenOrClosedShadowRoot } from '../src/relay/shadow';

/**
 * ISOLATED-world relay (Tasks 3.20 + 3.21, P2 PRD §A.2 / §A.3).
 *
 * Runs at `document_start` in the ISOLATED world so it is present before the
 * MAIN-world recorder's first `window.postMessage`, and so it has `chrome.*`
 * (which MAIN does not). Its job:
 *
 *   1. Receive `{ source: 'peek' | 'peek-net', payload }` posts from the
 *      recorder, validating each as untrusted input (the page shares the realm
 *      the recorder runs in — threat model §H1).
 *   2. Apply @cubenest/rrweb-core masking BEFORE forwarding (the privacy
 *      boundary): redact network headers/bodies, mask console-arg PII. Raw
 *      input values / auth headers must NOT leave this content script.
 *   3. Batch + forward to the SW via `chrome.runtime.sendMessage`; the SW
 *      forwards over the native port to peek-mcp (ADR-0007).
 *   4. (3.21) Walk the DOM for closed shadow roots via
 *      `chrome.dom.openOrClosedShadowRoot` and report the gaps best-effort.
 *
 * `matches` is broad but `host_permissions: []` (ADR-0008): Chrome only
 * executes this script on origins where the user granted the optional host
 * permission, so static registration still respects per-site activation. The
 * MAIN recorder is injected separately by the SW on enable.
 *
 * NOTE on permission level: per the chunk plan, recording runs whenever a site
 * is enabled. The 3d-3 permission gating slots in by having the SW (which knows
 * the per-origin level) drop/forward batches — the relay stays level-agnostic.
 */
export default defineContentScript({
  matches: ['https://*/*', 'http://*/*'],
  runAt: 'document_start',
  allFrames: true,
  world: 'ISOLATED',
  // Don't emit WXT's own startup postMessage onto the page (future default).
  noScriptStartedPostMessage: true,
  main(ctx) {
    // --- Batching + flush -------------------------------------------------
    // Separate buffers per channel so a console-heavy page doesn't starve net
    // records and vice versa. Each flush is one sendCmd to the SW.
    const rrwebBatch = new EventBatcher<unknown>();
    const consoleBatch = new EventBatcher<RelayConsoleEvent>();
    const netBatch = new EventBatcher<NetMessage>();
    const FLUSH_INTERVAL_MS = 1000;

    // Send a batch to the SW, swallowing the SW-asleep case (carry-in [10]):
    // sendCmd throws a typed ServiceWorkerUnavailableError which we drop — the
    // recorder keeps producing and the next flush retries. We never want an
    // unhandled rejection or a thrown error to break the page.
    const send = (cmd: Cmd): void => {
      void sendCmd(cmd).catch(() => {
        // SW down or handler error — drop this batch. Capture is best-effort;
        // losing a batch is acceptable, breaking the page is not.
      });
    };

    const flush = (): void => {
      if (!rrwebBatch.isEmpty || !consoleBatch.isEmpty) {
        const events = rrwebBatch.drain();
        const consoleEvents = consoleBatch.drain();
        if (events.length > 0 || consoleEvents.length > 0) {
          send({ type: 'recorder.events', events, console: consoleEvents });
        }
      }
      if (!netBatch.isEmpty) {
        send({ type: 'recorder.net', records: netBatch.drain() });
      }
    };

    const timer = setInterval(flush, FLUSH_INTERVAL_MS);

    // --- MAIN-world message intake ----------------------------------------
    const onMessage = (ev: MessageEvent): void => {
      // Only same-window posts (the recorder runs in this window's MAIN world).
      // Cross-frame/cross-origin posts can't be the recorder; reject early.
      if (ev.source !== window) return;
      const data: unknown = ev.data;
      if (!isPeekMessage(data)) return; // not ours — ignore untrusted noise

      const msg = data as PeekMessage;

      if (isRrwebMessage(msg)) {
        handleRrweb(msg.payload);
        return;
      }
      if (isNetMessage(msg)) {
        // MASK BEFORE BUFFERING — raw headers/bodies never sit in our buffer.
        const masked = maskNetMessage(msg.payload);
        if (netBatch.add(masked)) flush();
      }
    };

    // rrweb events: a console-plugin event carries the page's RAW console.log
    // args (data.payload.payload: string[]) — tokens/passwords/JWTs the app
    // logged. Those go ONLY through the masked consoleBatch path and are NOT
    // added to rrwebBatch, which the SW ships verbatim via session.append
    // (review issue 1: the raw rrweb console event would otherwise leak
    // unmasked to the native host). The SW reconstructs console data from the
    // masked recorder.events `console` array, never from the raw stream, so
    // dropping the raw console event from rrwebBatch loses nothing.
    const handleRrweb = (payload: unknown): void => {
      const consoleEvent = extractConsoleEvent(payload);
      if (consoleEvent) {
        if (consoleBatch.add(consoleEvent)) flush();
        return; // do NOT forward the unmasked raw console event
      }
      if (rrwebBatch.add(payload)) flush();
    };

    window.addEventListener('message', onMessage);

    // --- Closed shadow root sweep (Task 3.21) -----------------------------
    // rrweb (MAIN world) misses CLOSED shadow roots; chrome.dom is ISOLATED-
    // only. Sweep the DOM on mutations (debounced) and report gaps. Best-effort
    // — `chrome.dom` is absent on Safari, where getOpenOrClosedShadowRoot()
    // returns undefined and the sweep only flags heuristically-unreachable
    // hosts.
    const openOrClosed = getOpenOrClosedShadowRoot();
    let shadowTimer: ReturnType<typeof setTimeout> | null = null;
    const lastReported = new Set<string>();

    const sweepShadow = (): void => {
      try {
        const reports = collectShadowReports(document, openOrClosed);
        const fresh: ShadowReport[] = [];
        for (const r of reports) {
          const key = `${r.hostPath}|${r.source}|${r.mode}`;
          if (lastReported.has(key)) continue;
          lastReported.add(key);
          fresh.push(r);
        }
        if (fresh.length > 0) send({ type: 'recorder.shadow', reports: fresh });
      } catch {
        // A traversal failure must never break the page.
      }
    };

    const scheduleSweep = (): void => {
      if (shadowTimer !== null) return;
      shadowTimer = setTimeout(() => {
        shadowTimer = null;
        sweepShadow();
      }, 500);
    };

    const observer = new MutationObserver(scheduleSweep);
    // documentElement exists at document_start; observe subtree mutations.
    if (document.documentElement) {
      observer.observe(document.documentElement, { childList: true, subtree: true });
    }
    // Initial sweep once the DOM is parsed.
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', sweepShadow, { once: true });
    } else {
      scheduleSweep();
    }

    // --- Teardown ---------------------------------------------------------
    // On extension reload/disable WXT aborts the content script; flush what we
    // have and detach so we don't leak listeners/timers into the page.
    ctx.onInvalidated(() => {
      window.removeEventListener('message', onMessage);
      observer.disconnect();
      clearInterval(timer);
      if (shadowTimer !== null) clearTimeout(shadowTimer);
      flush();
    });
  },
});
