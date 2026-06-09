import { defineContentScript } from 'wxt/utils/define-content-script';
import { createRecordingFrame } from '../src/indicators/frame';
import { SHOW_RECORDING_BORDER_KEY, getShowRecordingBorder } from '../src/indicators/storage';
import {
  type Cmd,
  type RelayConsoleEvent,
  type ShadowReport,
  isRecordingStateMessage,
  sendCmd,
} from '../src/messaging/protocol';
import {
  PEEK_RRWEB_SOURCE,
  type PeekMessage,
  isHandshakeMessage,
  isPeekMessage,
  isRrwebMessage,
} from '../src/recorder/messages';
import { EventBatcher } from '../src/relay/batch';
import { extractConsoleEvent, isConsolePluginEvent } from '../src/relay/console-extract';
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
    // Separate buffers per channel so a console-heavy page doesn't starve
    // rrweb events and vice versa. Each flush is one sendCmd to the SW.
    //
    // Network records used to ride a third `netBatch` channel populated by a
    // MAIN-world fetch/XHR monkey-patch. Phase 5 / alpha.6 (Task #72) removed
    // that path — the rrweb network plugin emits its events through the same
    // rrweb event stream as everything else (`rrwebBatch`), and the SW's
    // `network-plugin-synth.ts` materializes them onto `network.append`.
    const rrwebBatch = new EventBatcher<unknown>();
    const consoleBatch = new EventBatcher<RelayConsoleEvent>();
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
    };

    const timer = setInterval(flush, FLUSH_INTERVAL_MS);

    // The MAIN-world recorder and this content script both run at
    // document_start in different execution contexts; the recorder may emit
    // its initial Meta + FullSnapshot before this listener attaches, losing
    // those events forever (the s_d37f7982 symptom). Respond to handshake
    // probes so the recorder can buffer until we're ready, then drain.
    const announceReady = (): void => {
      try {
        window.postMessage({ source: PEEK_RRWEB_SOURCE, kind: 'relay-ready' }, '*');
      } catch {
        // postMessage can't realistically fail on a same-window primitive
        // payload, but defense-in-depth — don't break the page.
      }
    };

    // --- MAIN-world message intake ----------------------------------------
    const onMessage = (ev: MessageEvent): void => {
      // Only same-window posts (the recorder runs in this window's MAIN world).
      // Cross-frame/cross-origin posts can't be the recorder; reject early.
      if (ev.source !== window) return;
      const data: unknown = ev.data;
      if (!isPeekMessage(data)) return; // not ours — ignore untrusted noise

      const msg = data as PeekMessage;

      if (isHandshakeMessage(msg)) {
        // Recorder loaded after us, missed the initial broadcast — answer the
        // probe so it can drain its buffer.
        if (msg.kind === 'recorder-probe') announceReady();
        return;
      }

      if (isRrwebMessage(msg)) {
        handleRrweb(msg.payload);
      }
    };

    // rrweb events: a console-plugin event carries the page's RAW console.log
    // args (data.payload.payload: string[]) — tokens/passwords/JWTs the app
    // logged. Those go ONLY through the masked consoleBatch path and are NEVER
    // added to rrwebBatch, which the SW ships verbatim via session.append
    // (review issue 1: the raw rrweb console event would otherwise leak
    // unmasked to the native host). The SW reconstructs console data from the
    // masked recorder.events `console` array, never from the raw stream, so
    // dropping the raw console event from rrwebBatch loses nothing.
    //
    // The gate is `isConsolePluginEvent` (the SHAPE), not the extraction result:
    // a malformed console-plugin event (e.g. missing `data.payload`) yields a
    // null extraction but must STILL be dropped, not fall through to rrwebBatch.
    // The invariant "console-plugin events never reach rrwebBatch" holds for ALL
    // shapes — defense-in-depth on the privacy boundary.
    const handleRrweb = (payload: unknown): void => {
      if (isConsolePluginEvent(payload)) {
        const consoleEvent = extractConsoleEvent(payload);
        if (consoleEvent && consoleBatch.add(consoleEvent)) flush();
        return; // ALWAYS drop the raw console event, even if extraction was null
      }
      if (rrwebBatch.add(payload)) flush();
    };

    window.addEventListener('message', onMessage);
    // Recorder loaded before us? Tell it we're listening now so it drains its
    // buffer. Recorder loaded after us? Its first probe lands in onMessage and
    // we respond there.
    announceReady();

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

    // --- Recording-active glow (top frame only) ---------------------------
    // Drawn inside a CLOSED shadow root (frame.ts) so rrweb never serializes it
    // and the sweep above skips its marked host. The always-on toolbar badge is
    // the primary signal; this is the on-page complement, gated by a user
    // setting. We PULL current state on mount (the SW only pushes on changes, so
    // a reloaded relay would otherwise miss an in-progress recording) and also
    // LISTEN for live push updates.
    if (window.top === window.self) {
      const frame = createRecordingFrame();
      let recording = false;
      let gotPush = false;
      let showBorder = true; // default-on; refined by the stored setting below
      const applyFrame = (): void => {
        if (recording && showBorder) frame.show();
        else frame.hide();
      };

      // Register the push listener BEFORE pulling, so a state change landing
      // during the async pull isn't dropped (last-write-wins is fine for a
      // visual indicator).
      const onRecordingMessage = (msg: unknown): undefined => {
        if (isRecordingStateMessage(msg)) {
          gotPush = true;
          recording = msg.recording;
          applyFrame();
        }
        return undefined;
      };
      chrome.runtime.onMessage.addListener(onRecordingMessage);

      // Pull current recording state on mount (closes the reload race).
      void sendCmd({ type: 'getRecordingState' })
        .then((res) => {
          // A push that already landed reflects a state change at or after the
          // SW computed this pull response, so it's at least as fresh — don't let
          // the (possibly stale) pull overwrite it.
          if (gotPush) return;
          recording = res.recording;
          applyFrame();
        })
        .catch(() => {
          // SW unreachable — stay hidden; a later push will correct it.
        });

      // Read the user setting; default-on if unreadable.
      void getShowRecordingBorder()
        .then((v) => {
          showBorder = v;
          applyFrame();
        })
        .catch(() => {
          // Keep the default (on).
        });

      // Live-toggle the glow when the setting changes mid-recording.
      const onBorderSettingChanged = (
        changes: Record<string, chrome.storage.StorageChange>,
        area: string,
      ): void => {
        if (area !== 'sync' || !(SHOW_RECORDING_BORDER_KEY in changes)) return;
        const next = changes[SHOW_RECORDING_BORDER_KEY]?.newValue;
        showBorder = next !== false;
        applyFrame();
      };
      chrome.storage.onChanged.addListener(onBorderSettingChanged);

      ctx.onInvalidated(() => {
        chrome.runtime.onMessage.removeListener(onRecordingMessage);
        chrome.storage.onChanged.removeListener(onBorderSettingChanged);
        frame.dispose();
      });
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
