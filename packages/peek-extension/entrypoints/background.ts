import { maskTextContent } from '@cubenest/rrweb-core';
import { defineBackground } from 'wxt/utils/define-background';
import { originFromUrl } from '../src/activation/origin';
import { diffAddedOrigins } from '../src/activation/storage';
import {
  CONNECTION_HELD_MS,
  INITIAL_BACKOFF_MS,
  jitter,
  nextBackoffMs,
} from '../src/background/backoff';
import { type ActionSurface, applyBadge } from '../src/background/badge';
import {
  type NativeOutbound,
  consoleAppend,
  networkAppend,
  sessionAppend,
  shadowReport,
} from '../src/background/native-protocol';
import { synthesizeNetMessagesFromEvents } from '../src/background/network-plugin-synth';
import { RecordingStateStore, isTabRecording } from '../src/background/recording-state';
import { SessionRegistry } from '../src/background/session';
import { RecorderStatsStore } from '../src/background/stats';
import { ACTION_FEEDBACK_HOST_ATTR, ENABLED_ORIGINS_KEY, NATIVE_HOST_ID } from '../src/constants';
import {
  DEEP_CAPTURE_ORIGINS_KEY,
  DeepCaptureManager,
  buildChromeDebuggerSurface,
  diffRemovedOrigins,
  isDeepCaptureEnabled,
} from '../src/deep-capture';
import { getShowActionFeedback } from '../src/indicators/storage';
import type {
  Cmd,
  CmdResponse,
  ConfirmVerdictMessage,
  NativeHostState,
  PairVerdictMessage,
  RecordingStateMessage,
  RelayAck,
  RevokePairingMessage,
  ShowConfirmMessage,
  ShowPairMessage,
} from '../src/messaging/protocol';
import {
  denyReason,
  isFromSidePanel,
  isPairVerdict,
  isRevokePairing,
} from '../src/messaging/protocol';
import {
  type ElementFeedbackArgs,
  FEEDBACK_CSS,
  type PageToastArgs,
  elementFeedbackFor,
  pageToastFor,
  showElementFeedback,
  showPageToast,
} from '../src/permissions/action-feedback';
import {
  type ActionHandlerDeps,
  InMemoryConfirmTokenStore,
  handleActionRequest,
} from '../src/permissions/action-handler';
import type {
  Action,
  ActionResultMessage,
  PairRequestMessage,
  ScreenshotAction,
} from '../src/permissions/action-protocol';
import { isActionRequest, isPairRequest } from '../src/permissions/action-protocol';
import {
  type HandoffEligibility,
  dispatchAction,
  resolveHandoffEligibility,
  resolveTarget as resolveTargetInPage,
} from '../src/permissions/dispatcher';
import { type HighlightResult, applyHighlight, clearHighlight } from '../src/permissions/highlight';
import { ALWAYS_FOR_SITE_LEVEL } from '../src/permissions/levels';
import { maskElementDetail, maskPageViewNode } from '../src/permissions/mask-view';
import {
  PAIR_TIMEOUT_MS,
  connectorIdFromClientName,
  mintPairingSecret,
} from '../src/permissions/pair-handler';
import {
  clearPairedConnector,
  putPairedConnector,
  sha256Hex,
} from '../src/permissions/pairing-store';
import {
  type ElementDetail,
  type ElementDetailError,
  type PageViewDelta,
  type PageViewResult,
  buildElementDetail,
  buildPageView,
  diffPageViewStandalone,
} from '../src/permissions/snapshot';
import {
  PERMISSION_LEVELS_KEY,
  getPermissionLevel,
  setPermissionLevel,
} from '../src/permissions/store';
import { YoloSessionStore } from '../src/permissions/yolo';
import { injectRecorder } from '../src/recorder/inject';
import { maskUrl } from '../src/relay/mask-url';
import { ShieldController } from '../src/shield/controller';
import { type ShieldInbound, isShieldInbound } from '../src/shield/protocol';

/** Fail-closed timeout for a pending Level-3 confirm (locked MVP decision). */
const CONFIRM_TIMEOUT_MS = 2 * 60_000;

/**
 * Read-only verbs that NEVER touch a DOM element destructively: a passive
 * `waitFor` (observe-or-timeout) and a `screenshot` (pixel capture). The
 * destructive-confirm matcher inspects an action's resolved element; a read-only
 * verb must skip element resolution entirely so a benign capture/wait can never
 * trip the destructive matcher (e.g. a `screenshot` whose `selector` happens to
 * land on a "Delete" button must NOT force a confirm — it isn't clicking it).
 */
export function isReadOnlyAction(action: Action): boolean {
  return action.type === 'waitFor' || action.type === 'screenshot';
}

/**
 * Build the positional args for the MAIN-world {@link resolveTargetInPage}
 * injection that resolves an action's destructive-matcher signals.
 *
 * SECURITY: `chrome.scripting.executeScript` REJECTS a non-JSON-serializable
 * `undefined` in `args` — the call THROWS ("may only contain JSON-serializable
 * values"). The previous wiring passed `[selector, nth, ref]` with `nth`/`ref`
 * left `undefined` for an ordinary click; the throw was swallowed by the dep's
 * catch, which fails OPEN to "no signals" → the destructive matcher never ran →
 * a Level-4 `Delete`/`Pay`/`Transfer` click was auto-allowed with NO confirm
 * banner, defeating the destructive override (caught by the R2 live-test
 * runbook §C2; the unit/e2e suites inject these funcs directly, bypassing real
 * `executeScript` arg serialization).
 *
 * The fix: coerce the optionals to serializable sentinels that
 * `resolveTargetInPage` already treats as "absent" — `nth` 0 (→ first match,
 * same as omitting it) and `ref` '' (length 0 → skips the ref-registry branch).
 * Returns `null` for page-level verbs (neither ref nor selector) so the caller
 * skips resolution entirely.
 */
export function resolveTargetArgs(action: Action): [string, number, string] | null {
  const selector =
    'selector' in action && typeof action.selector === 'string' ? action.selector : '';
  const ref = 'ref' in action && typeof action.ref === 'string' ? action.ref : '';
  if (ref.length === 0 && selector.length === 0) return null;
  const nth = 'nth' in action && typeof action.nth === 'number' ? action.nth : 0;
  return [selector, nth, ref];
}

/**
 * The mutating verbs whose post-action `observe` diff RE-WALKS the page: the
 * page context (and the ref registry) survive, so a `diffPageView` is meaningful.
 * Navigating verbs (navigate/back/forward/reload) tear down the context, so they
 * get the `{navigated:true}` marker instead (see dispatchInMainWorld).
 */
const OBSERVE_DIFFABLE_VERBS: ReadonlySet<Action['type']> = new Set([
  'click',
  'type',
  'dblclick',
  'scroll',
  'enter',
]);

/**
 * The navigating verbs whose `observe` returns a `{navigated:true}` marker
 * (no diff — the page context + ref registry are torn down by the navigation,
 * so a diff would be meaningless).
 */
const OBSERVE_NAVIGATING_VERBS: ReadonlySet<Action['type']> = new Set([
  'navigate',
  'back',
  'forward',
  'reload',
]);

/**
 * Screenshot via CDP `Page.captureScreenshot`. `chrome.tabs.captureVisibleTab`
 * requires `<all_urls>` or an `activeTab` user gesture — neither available in
 * the MCP → native-host → SW call path (no user gesture). CDP uses the
 * `debugger` permission already in static `permissions` (wxt.config.ts P-14),
 * so it works programmatically without violating ADR-0008.
 *
 * If the debugger is already attached (Deep capture), reuses the session.
 * Otherwise attaches temporarily, captures, then detaches.
 */
async function captureViaDebugger(tabId: number): Promise<string> {
  let didAttach = false;
  try {
    await chrome.debugger.attach({ tabId }, '1.3');
    didAttach = true;
  } catch (err) {
    // "Another debugger is already attached" (Deep capture) — reuse the session.
    const msg = err instanceof Error ? err.message : String(err);
    if (!msg.toLowerCase().includes('already attached')) throw err;
  }
  try {
    const result = (await chrome.debugger.sendCommand({ tabId }, 'Page.captureScreenshot', {
      format: 'png',
      quality: 80,
      captureBeyondViewport: false,
    })) as { data: string };
    return `data:image/png;base64,${result.data}`;
  } finally {
    if (didAttach) {
      // Best-effort: tab may have been closed during capture.
      await chrome.debugger.detach({ tabId }).catch(() => {});
    }
  }
}

/**
 * SW-level screenshot capture (a page cannot screenshot itself, so this is
 * handled BEFORE the MAIN-world dispatch). MANDATORY active-tab guard: CDP
 * captures a tab's rendered state; a non-visible tab may have a stale paint
 * tree. We refuse rather than auto-activate.
 *
 * `action.selector` is accepted but IGNORED in v1 (no element-crop yet); the
 * reply always sets `selectorCropped:false` so the caller knows it got the full
 * visible viewport.
 */
export async function captureScreenshot(
  tabId: number,
  _action: ScreenshotAction,
): Promise<{ ok: true; details: unknown } | { ok: false; error: string }> {
  let windowId: number;
  try {
    const tab = await chrome.tabs.get(tabId);
    if (tab.windowId === undefined) {
      return { ok: false, error: 'screenshot target tab has no window' };
    }
    windowId = tab.windowId;
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
  // Active-tab guard: a non-visible tab may have a stale/blank paint tree.
  const [active] = await chrome.tabs.query({ active: true, windowId });
  if (active?.id !== tabId) {
    return { ok: false, error: 'screenshot requires the target tab to be active' };
  }
  try {
    const dataUrl = await captureViaDebugger(tabId);
    return { ok: true, details: { dataUrl, format: 'png', selectorCropped: false } };
  } catch (err) {
    return {
      ok: false,
      error: `screenshot failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

/**
 * Background service worker (ADR-0009).
 *
 * The single most important thing this file does is anchor the MV3 service
 * worker's lifetime on a persistent `chrome.runtime.connectNative()` port to
 * the native host. MV3 SWs die after 30s idle (5min hard cap); the native port
 * is Chrome's documented keep-alive anchor. `connectNative` runs at module
 * top-level (every SW wake) plus on `onStartup` / `onInstalled`, and the
 * `onDisconnect` handler reconnects with exponential backoff (1s → 60s).
 *
 * The reconnect *arithmetic* lives in src/background/backoff.ts (pure +
 * unit-tested); this file owns the `chrome.*` side effects and timers.
 *
 * Failure mode (ADR-0009 #4): if the native host is not installed or is
 * uninstalled, `connectNative` fails and the SW loses its background-
 * persistence guarantee. The extension still functions — the side panel and
 * per-site activation work — but background work pauses until the host comes
 * back, at which point the backoff reconnect re-establishes the port.
 *
 * Chunk boundaries:
 *   - 3d-1: the keep-alive anchor + side-panel behavior + a message router stub.
 *   - 3d-2 (this chunk): inject the MAIN-world recorder on per-site-enabled
 *     tabs; receive ISOLATED-relay batches, fold per-tab RecorderStats, forward
 *     them over the native port to peek-mcp.
 *   - 3d-3: permission-level gating of forwarding + native-host request/response
 *     for action execution + audit.
 */
export default defineBackground({
  type: 'module',
  main() {
    let nativePort: chrome.runtime.Port | null = null;
    let reconnectBackoff = INITIAL_BACKOFF_MS;
    let hostState: NativeHostState = 'disconnected';
    // Consecutive failed reconnect attempts since the last successful connect.
    // Reported to the side panel so a *persistently* failing reconnect (host
    // never registered) can surface the "run `peek init`" setup hint instead of
    // a perpetual "Reconnecting…" pill (Windows audit bug). Reset to 0 on a
    // successful connectNative.
    let reconnectAttempts = 0;
    // Whether a native-host connection has ever HELD this SW session (set when
    // the connection-held timer below fires). Drives the side panel's
    // "Connecting…" vs "Reconnecting…" label — a 'reconnecting' state before any
    // hold is really the FIRST connect, not a re-connect.
    let hasEverConnected = false;
    // Single pending reconnect timer. Holding the handle lets us collapse all
    // disconnect/wake races into ONE pending reconnect (see scheduleReconnect).
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    // "Connection held" timer: connectNative sets hostState='connected'
    // synchronously, but an unregistered host on Chrome returns a port that
    // immediately fires onDisconnect ("host not found") — a disconnect-storm,
    // not a synchronous throw. So we DON'T clear reconnectAttempts the instant a
    // port handle appears (that transient 'connected' would reset the counter
    // every storm cycle and the stall hint would never surface). Instead we arm
    // this timer on connect; only if the port survives CONNECTION_HELD_MS
    // without disconnecting do we treat the connection as real and reset the
    // counter. onDisconnect cancels it.
    let connectionHeldTimer: ReturnType<typeof setTimeout> | null = null;

    // Per-tab capture state (3d-2). Lives only in this SW instance; if the SW is
    // torn down the counts reset — acceptable, the side panel re-polls and the
    // native host owns durable state.
    const stats = new RecorderStatsStore();
    const sessions = new SessionRegistry();

    // Recording-active indicator (per-tab). Drives the always-on toolbar badge
    // and pushes state to the ISOLATED relay's in-page glow. In-memory like
    // stats/sessions — re-derived on wake by reconcileIndicators().
    const recordingState = new RecordingStateStore();
    const actionSurface = chrome.action as unknown as ActionSurface;

    async function setTabRecording(tabId: number, recording: boolean): Promise<void> {
      const changed = recordingState.set(tabId, recording);
      // Re-assert the badge unconditionally so a stale per-tab badge left by a
      // previous SW instance is corrected on wake (idempotent, best-effort).
      await applyBadge(actionSurface, tabId, recording);
      if (!changed) return;
      try {
        await chrome.tabs.sendMessage(tabId, {
          type: 'recording.state',
          recording,
        } satisfies RecordingStateMessage);
      } catch {
        // No content script in the tab (chrome:// page, or not injected yet) —
        // best-effort; the badge already carries the signal.
      }
    }

    async function reconcileIndicators(): Promise<void> {
      let tabs: chrome.tabs.Tab[];
      try {
        tabs = await chrome.tabs.query({});
      } catch {
        return;
      }
      for (const tab of tabs) {
        if (tab.id === undefined) continue;
        await setTabRecording(tab.id, await isTabRecording(tab.url));
        // Control-shield (Plan A): re-derive the correct phase from durable
        // level + host state on every SW wake and repair the view.
        const origin = originFromUrl(tab.url ?? null);
        if (origin) void shield.reconcile(tab.id, origin);
      }
    }

    // Permission state (3d-3). Both in-memory + scoped to this SW instance.
    const yolo = new YoloSessionStore();
    const confirmTokens = new InMemoryConfirmTokenStore();

    // Control-shield (Plan A). Pure SW state machine; every chrome.* effect
    // goes through these deps. Drives the Level-4 lockout overlay in the
    // isolated relay via chrome.tabs.sendMessage to frameId 0.
    //
    // SCOPE NOTE: the shield is driven by persistent-level changes (the
    // PERMISSION_LEVELS_KEY storage.onChanged fan-out below) + reconcile on
    // wake/view-ready. YOLO-derived effective Level 4 is intentionally NOT a
    // trigger here because yolo.activate() has no production caller (design
    // §13). When YOLO activation is wired later, it MUST notify the shield
    // directly — call shield.onLevelChanged(tabId, origin, 4) on activate and
    // subscribe yolo.onExpiry to fan a lower out to the origin's tabs — because
    // YOLO transitions don't write storage, so they never hit the fan-out
    // (storage stays at the floor → the before===after check skips it).
    const shield = new ShieldController({
      commandView(tabId, cmd) {
        // Top frame only (frameId 0); best-effort like setTabRecording.
        void chrome.tabs.sendMessage(tabId, cmd, { frameId: 0 }).catch(() => {});
      },
      async dropToSafeLevel(origin) {
        try {
          await setPermissionLevel(origin, 1);
        } catch (err) {
          console.warn('[peek] dropToSafeLevel persist failed:', err);
        }
        yolo.revoke(origin);
      },
      isHostConnected: () => hostState === 'connected' && nativePort !== null,
      async getEffectiveLevel(origin) {
        const persistent = await getPermissionLevel(origin);
        return yolo.isActive(origin) ? 4 : persistent;
      },
      // Handoff timeout scheduling (Plan B). Real timers; the handle is opaque
      // (`unknown`) at the deps boundary, so cast on the way in/out — a plain
      // `typeof === 'number'` guard would silently skip clearTimeout under
      // object-handle setTimeout typings and orphan the handoff timeout.
      setTimer: (fn, ms) => setTimeout(fn, ms) as unknown,
      clearTimer: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
    });

    // Pending Level-3 confirm prompts (Phase 3e). Keyed by requestId; the
    // side panel posts a `confirmVerdict` that resolves the awaiting promise.
    // In-memory + scoped to this SW instance: per the locked MVP decision, SW
    // death during a pending confirm fail-closes (the awaiting MCP tool times
    // out → deny, audit-logged). We do NOT persist to chrome.storage.session.
    const pendingConfirms = new Map<
      string,
      { resolve: (v: ConfirmVerdictMessage) => void; timer: ReturnType<typeof setTimeout> }
    >();

    /** Resolve a pending confirm by requestId (idempotent). */
    function resolvePendingConfirm(verdict: ConfirmVerdictMessage): void {
      const entry = pendingConfirms.get(verdict.requestId);
      if (!entry) return;
      pendingConfirms.delete(verdict.requestId);
      clearTimeout(entry.timer);
      entry.resolve(verdict);
    }

    // Pending SP4 connector-pairing prompts. Keyed by requestId; the side
    // panel posts a `pairVerdict` that resolves the awaiting promise.
    // Same fail-closed / in-memory pattern as pendingConfirms above.
    const pendingPairings = new Map<
      string,
      { resolve: (v: PairVerdictMessage) => void; timer: ReturnType<typeof setTimeout> }
    >();

    /** Resolve a pending pairing by requestId (idempotent). */
    function resolvePendingPairing(verdict: PairVerdictMessage): void {
      const entry = pendingPairings.get(verdict.requestId);
      if (!entry) return;
      pendingPairings.delete(verdict.requestId);
      clearTimeout(entry.timer);
      entry.resolve(verdict);
    }

    // Deep capture (3d-4, Task 3.26). The manager is lazily constructed on
    // first attach because constructing it registers an event listener on
    // `chrome.debugger.onEvent`, and `chrome.debugger` is only present when
    // the user has granted the optional `debugger` permission. Accessing
    // `chrome.debugger` before grant throws.
    let deepCapture: DeepCaptureManager | null = null;
    function getOrInitDeepCapture(): DeepCaptureManager | null {
      if (deepCapture !== null) return deepCapture;
      if (typeof chrome.debugger === 'undefined') return null;
      deepCapture = new DeepCaptureManager({
        debugger: buildChromeDebuggerSurface(),
        onBody: (tabId, record) => {
          // Route the masked body through the existing network.append
          // channel so the host's network_events row stores it.
          const ref = sessions.peek(tabId);
          if (!ref) {
            console.debug('[peek] Deep capture body without active session — dropped');
            return;
          }
          forwardToHost(networkAppend(ref, [record]));
        },
      });
      return deepCapture;
    }

    /**
     * Sync the manager's attached set with persisted Deep-capture state for
     * `tabId`. Called on tab activation/update + on storage change. Idempotent
     * for both attach and detach.
     */
    async function syncDeepCaptureForTab(tabId: number, url: string | undefined): Promise<void> {
      if (!url) return;
      let enabled = false;
      try {
        enabled = await isDeepCaptureEnabled(url);
      } catch {
        return;
      }
      const mgr = getOrInitDeepCapture();
      if (!mgr) return; // permission not granted yet — nothing to do.
      try {
        if (enabled) await mgr.attach(tabId);
        else await mgr.detach(tabId);
      } catch (err) {
        console.debug('[peek] Deep capture sync failed:', err);
      }
    }

    function handleHostMessage(message: unknown): void {
      // SP4: pairing handshake — checked before the action guard so pair.request
      // messages never fall through to the act path.
      if (isPairRequest(message)) {
        void handlePairRequest(message);
        return;
      }
      // Action request from peek-mcp's native-host process (Task 3.24). The
      // handler routes through the permission gate, the destructive matcher,
      // and (for Level 3) the side-panel banner. The result message ID echoes
      // the requestId so the host correlates back to the awaiting MCP tool.
      if (isActionRequest(message)) {
        void handleActionRequest(message, {
          async getTabFor(req) {
            if (req.tabId !== undefined) {
              try {
                const tab = await chrome.tabs.get(req.tabId);
                return tab;
              } catch {
                // fall through to active-tab lookup
              }
            }
            const [active] = await chrome.tabs.query({
              active: true,
              lastFocusedWindow: true,
            });
            return active;
          },
          // Item A (TOCTOU): the dispatch-time re-validation must inspect the
          // EXACT tab the gate resolved — not whatever is active now. Re-fetch
          // by id (never an active-tab query), so a sibling tab can't satisfy
          // the re-check while the captured tab navigated cross-origin.
          async getTabById(tabId) {
            try {
              return await chrome.tabs.get(tabId);
            } catch {
              return undefined; // tab closed during the confirm wait
            }
          },
          yolo,
          tokens: confirmTokens,
          promptUserConfirmation,
          resolveTarget,
          dispatchInMainWorld,
          onActionLabel(tabId, label) {
            shield.onActionLabel(tabId, label);
          },
          // Part 2: agent-set control-shield banner string (Level ≥4;
          // fire-and-forget, pre-gate auto-allow).
          onSetIntent(tabId, text, status) {
            shield.onSetIntent(tabId, text, status);
          },
          // Plan B: shield active means up OR already in a handoff — a
          // selector-less `enter` must reject in BOTH (don't dispatch to Stop).
          isShieldActive(tabId) {
            return shield.isShieldActive(tabId);
          },
          enterHandoff(input) {
            return shield.enterHandoff(input.tabId, {
              prompt: input.prompt,
              framing: input.framing,
              ...(input.selector !== undefined ? { selector: input.selector } : {}),
              // Part 2: forward the handler-resolved scope so a page-scope
              // takeover (CAPTCHA / native widget / final review) isn't
              // silently downgraded to field-scope at the SW boundary.
              scope: input.scope ?? 'field',
              readBack: input.readBack,
              timeoutMs: input.timeoutMs,
            });
          },
          async resolveHandoffEligibility({ tabId, selector }) {
            // Fail-closed fallback: an ineligible (non-editable) element. The
            // dispatcher's `if (!elig || !elig.editable …)` branch folds this
            // into a structured `{ resumed:false, reason:'ineligible' }` reply.
            const fallback: HandoffEligibility = {
              editable: false,
              tagName: null,
              inputType: null,
              autocomplete: null,
              destructiveSignals: {},
              isConnected: false,
            };
            // A REJECTED executeScript (tab navigated/closed/discarded, or a
            // restricted URL where MAIN-world injection fails) must NOT escape:
            // it would propagate out of handleActionRequest, skip
            // forwardActionResult, and hang the awaiting MCP call until the
            // 5-min bridge timeout. Mirror the sibling MAIN-world helpers
            // (resolveTarget / dispatchInMainWorld) and return the fallback.
            try {
              const [res] = await chrome.scripting.executeScript({
                target: { tabId },
                world: 'MAIN',
                func: resolveHandoffEligibility,
                args: [selector],
              });
              return (res?.result as HandoffEligibility | undefined) ?? fallback;
            } catch (err) {
              console.debug('[peek] resolveHandoffEligibility MAIN-world script failed:', err);
              return fallback;
            }
          },
        })
          .then((reply) => forwardActionResult(reply))
          .catch((err) => {
            console.warn('[peek] action-handler threw:', err);
          });
        return;
      }
      // Other native-host → extension messages (capture-ingest acks, future
      // diagnostics). Receiving anything resets the SW idle timer, which is
      // the keep-alive guarantee we rely on.
    }

    /**
     * Forward an action.result terminal message back to the host through the
     * native port. Best-effort: a dropped reply will surface to the MCP tool
     * handler as a timeout.
     */
    function forwardActionResult(reply: ActionResultMessage): void {
      const port = nativePort;
      if (!port) return;
      try {
        port.postMessage(reply);
      } catch (err) {
        console.warn('[peek] action.result post failed:', err);
      }
    }

    /**
     * Emit a non-terminal `action.confirm.shown` timing signal to the host so
     * the audit log can record WHEN the user was prompted. Best-effort.
     */
    function postConfirmShown(requestId: string): void {
      const port = nativePort;
      if (!port) return;
      try {
        port.postMessage({ type: 'action.confirm.shown', requestId, shownAtMs: Date.now() });
      } catch (err) {
        console.debug('[peek] action.confirm.shown post failed:', err);
      }
    }

    /**
     * Resolve the destructive-matcher signals for the action's selector by
     * running the pure {@link resolveTargetInPage} in the tab's MAIN world.
     * Actions without a selector (back/forward/reload/navigate) resolve to an
     * empty target — the destructive matcher won't fire. Any scripting failure
     * resolves to an empty target (the gate still runs; Level 3 still confirms).
     */
    const resolveTarget: ActionHandlerDeps['resolveTarget'] = async ({ tabId, action }) => {
      // Read-only verbs (waitFor / screenshot) emit NO destructive signals: they
      // never operate on the resolved element, so resolving one would risk the
      // destructive matcher firing on an incidental selector hit. Short-circuit
      // BEFORE element resolution.
      if (isReadOnlyAction(action)) return {};
      // A target may be addressed by `ref` (from get_page_view) OR `selector`.
      // We MUST resolve whichever the dispatcher will act on so the destructive
      // matcher inspects the SAME element — otherwise a ref-targeted destructive
      // action (e.g. a "Delete" button by ref) would skip the destructive
      // override. Only page-level verbs (neither ref nor selector) skip here.
      //
      // The args MUST be JSON-serializable — a bare `undefined` makes
      // executeScript throw and the catch below fails open to "no signals",
      // silently disabling the destructive override. resolveTargetArgs coerces
      // the optionals to serializable sentinels; see its docstring. `null`
      // means a page-level verb (nothing to resolve).
      const args = resolveTargetArgs(action);
      if (args === null) return {};
      try {
        const [frame] = await chrome.scripting.executeScript({
          target: { tabId },
          world: 'MAIN',
          func: resolveTargetInPage,
          args,
        });
        return (frame?.result as Awaited<ReturnType<typeof resolveTargetInPage>>) ?? {};
      } catch (err) {
        console.debug('[peek] resolveTarget MAIN-world script failed:', err);
        return {};
      }
    };

    /**
     * A page-level verb (navigate/reload/back/forward) replaces the document, so
     * the toast must render on the DESTINATION page — wait for the tab to finish
     * loading, then inject once. A timeout removes the listener if the load never
     * completes (download, abort). Fire-and-forget; failures are swallowed.
     * `onUpdated` is a hoisted function declaration so addListener/removeListener
     * share one stable reference.
     */
    const scheduleActionToast = (
      tabId: number,
      toast: NonNullable<ReturnType<typeof pageToastFor>>,
    ): void => {
      let done = false;
      function onUpdated(updatedTabId: number, info: chrome.tabs.OnUpdatedInfo): void {
        if (updatedTabId !== tabId || info.status !== 'complete' || done) return;
        done = true;
        chrome.tabs.onUpdated.removeListener(onUpdated);
        const toastArgs: PageToastArgs = {
          verb: toast.verb,
          ...(toast.detail !== undefined ? { detail: toast.detail } : {}),
          hostAttr: ACTION_FEEDBACK_HOST_ATTR,
          css: FEEDBACK_CSS,
        };
        void chrome.scripting
          .executeScript({
            target: { tabId },
            world: 'MAIN',
            func: showPageToast,
            args: [toastArgs],
          })
          .catch(() => {});
      }
      // Best-effort matching: tabId + the first `complete` within the window.
      // A user-initiated navigation of the SAME tab inside the 8s window could
      // surface the toast on a page peek didn't navigate to (rare in an
      // agent-driven session). We intentionally do NOT gate navigate on a
      // `tab.url` host === detail match, since that would suppress the toast on
      // legitimate redirects (http→https, apex→www). Cosmetic false-positive
      // only; it never affects the action result.
      chrome.tabs.onUpdated.addListener(onUpdated);
      setTimeout(() => {
        if (!done) chrome.tabs.onUpdated.removeListener(onUpdated);
      }, 8000);
    };

    /**
     * Best-effort, fire-and-forget in-page action feedback. Called AFTER a
     * successful dispatch with the result already returned to the agent, so it
     * never blocks the act and its own failure is swallowed. (Task 7 handles
     * element verbs; Task 8 adds the page-level toast branch.)
     */
    const emitActionFeedback = async (tabId: number, action: Action): Promise<void> => {
      try {
        if (!(await getShowActionFeedback())) return;
        // The protocol Action union has NO index signature; cast to the
        // permissive shape the decision helpers accept (mirrors how
        // dispatchInMainWorld casts `action` for dispatchAction below).
        const a = action as unknown as { type: string; [k: string]: unknown };
        const plan = elementFeedbackFor(a);
        if (!plan) {
          // Page-level verbs replace the document — toast on the destination page.
          const toast = pageToastFor(a);
          if (toast) scheduleActionToast(tabId, toast);
          return;
        }
        const feedbackArgs: ElementFeedbackArgs = {
          verb: plan.verb,
          selector: plan.selector,
          ...(plan.nth !== undefined ? { nth: plan.nth } : {}),
          hostAttr: ACTION_FEEDBACK_HOST_ATTR,
          css: FEEDBACK_CSS,
        };
        void chrome.scripting
          .executeScript({
            target: { tabId },
            world: 'MAIN',
            func: showElementFeedback,
            args: [feedbackArgs],
          })
          .catch(() => {});
      } catch {
        /* feedback is best-effort — never affects the action */
      }
    };

    /**
     * Dispatch the allowed action in the tab's MAIN world via the pure
     * {@link dispatchAction}. Returns the first frame's serializable result; a
     * scripting error surfaces as `{ ok:false, error }` (the action-handler
     * folds that into a result=error reply).
     */
    const dispatchInMainWorld: ActionHandlerDeps['dispatchInMainWorld'] = async ({
      tabId,
      action,
    }) => {
      // `screenshot` is the ONE verb the MAIN-world dispatcher can't run (a page
      // can't screenshot itself). Handle it here, SW-side, BEFORE the
      // executeScript call — captureVisibleTab is an SW-only API.
      if (action.type === 'screenshot') {
        return await captureScreenshot(tabId, action);
      }
      // `highlight` / `clear_highlight` run their OWN self-contained MAIN-world
      // functions (not the generic dispatcher), so route them here — mirroring
      // the screenshot special-case above.
      if (action.type === 'highlight') {
        try {
          const [frame] = await chrome.scripting.executeScript({
            target: { tabId },
            world: 'MAIN',
            func: applyHighlight,
            args: [action.selector, action.label] as Parameters<typeof applyHighlight>,
          });
          return (
            (frame?.result as HighlightResult | undefined) ?? {
              ok: false,
              error: 'no result from MAIN-world highlight',
            }
          );
        } catch (err) {
          return { ok: false, error: err instanceof Error ? err.message : String(err) };
        }
      }
      if (action.type === 'clear_highlight') {
        try {
          const [frame] = await chrome.scripting.executeScript({
            target: { tabId },
            world: 'MAIN',
            func: clearHighlight,
          });
          return (
            (frame?.result as HighlightResult | undefined) ?? {
              ok: false,
              error: 'no result from MAIN-world clear_highlight',
            }
          );
        } catch (err) {
          return { ok: false, error: err instanceof Error ? err.message : String(err) };
        }
      }
      // `page_view` (R1) runs its OWN self-contained MAIN-world walker, then we
      // mask the accessible names/values SW-side (raw sensitive input values were
      // already dropped in-page by buildPageView) and format compact ref-tagged
      // lines so the agent can target a `ref`. Token-lean: one text block, not an
      // array of objects with repeated keys.
      if (action.type === 'page_view') {
        try {
          const [frame] = await chrome.scripting.executeScript({
            target: { tabId },
            world: 'MAIN',
            func: buildPageView,
            args: [
              {
                ...(action.selector ? { selector: action.selector } : {}),
                maxElements: action.maxElements ?? 200,
              },
            ],
          });
          const view = frame?.result as PageViewResult | undefined;
          if (!view) return { ok: false, error: 'no result from MAIN-world page_view' };
          const lines = view.nodes.map((node) => {
            const name = maskTextContent(node.name);
            let value = '';
            if (node.value !== undefined) {
              value =
                node.value === '•••'
                  ? ' value=•••'
                  : ` value=${JSON.stringify(maskTextContent(node.value))}`;
            }
            const state = node.state ? ` (${node.state})` : '';
            return `${node.ref} ${node.role} "${name}"${value}${state}`;
          });
          return {
            ok: true,
            details: {
              // Path-mask the page URL with the SAME scheme as network URLs: a
              // query string can carry a token (?reset_token=…) — keep origin+path,
              // redact query VALUES (maskUrl) before it reaches the agent.
              url: maskUrl(view.url),
              title: maskTextContent(view.title),
              count: view.nodes.length,
              truncated: view.truncated,
              view: lines.join('\n'),
            },
          };
        } catch (err) {
          return { ok: false, error: err instanceof Error ? err.message : String(err) };
        }
      }
      // `element_detail` (R2) runs its OWN self-contained MAIN-world drill-in
      // (buildElementDetail is standalone — it inlines all helpers), then we mask
      // SW-side: name/value/text + every aria VALUE + every child name through
      // `maskTextContent`, and `href` through `maskUrl` (the SAME path/query mask
      // peek applies to network URLs). Raw sensitive input values were already
      // dropped in-page (`•••`). An expired ref surfaces as the action ERROR
      // (`ref expired …`) rather than a thrown exception, so the agent re-snapshots.
      if (action.type === 'element_detail') {
        try {
          const [frame] = await chrome.scripting.executeScript({
            target: { tabId },
            world: 'MAIN',
            func: buildElementDetail,
            args: [action.ref],
          });
          const detail = frame?.result as ElementDetail | ElementDetailError | undefined;
          if (!detail) return { ok: false, error: 'no result from MAIN-world element_detail' };
          if (!detail.ok) {
            // Expired/detached ref — surface as the action error, not a throw.
            return { ok: false, error: detail.error };
          }
          return { ok: true, details: maskElementDetail(detail) };
        } catch (err) {
          return { ok: false, error: err instanceof Error ? err.message : String(err) };
        }
      }
      let finalResult: { ok: true; details?: unknown } | { ok: false; error: string };
      try {
        const [frame] = await chrome.scripting.executeScript({
          target: { tabId },
          world: 'MAIN',
          func: dispatchAction,
          // The dispatcher accepts a permissive { type, ...rest } shape and
          // narrows defensively per branch; cast through unknown so the
          // protocol Action union (no index signature) is accepted.
          args: [action as unknown as Parameters<typeof dispatchAction>[0]],
        });
        const result = frame?.result as
          | { ok: true; details?: unknown }
          | { ok: false; error: string }
          | undefined;
        finalResult = result ?? { ok: false, error: 'no result from MAIN-world dispatch' };
        // Fire-and-forget the in-page cue AFTER computing the result; do not await.
        if (finalResult.ok) void emitActionFeedback(tabId, action);
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
      }
      // ---- Post-action `observe` diff (R2) --------------------------------
      // SAFETY / ORDERING: this runs ONLY in the success path of an action that
      // was already gated-allow + already dispatched (finalResult.ok). It NEVER
      // runs when the action was denied (this function is only reached after the
      // gate allows) or errored (the `!finalResult.ok` guard below). The diff is
      // a READ appended to an already-allowed, already-executed mutation — it must
      // not become a side-channel to read the page when the action itself failed.
      if (finalResult.ok && 'observe' in action && action.observe === true) {
        const viewDelta = await computeObserveDelta(tabId, action);
        return {
          ok: true,
          details: {
            ...(typeof finalResult.details === 'object' && finalResult.details !== null
              ? (finalResult.details as Record<string, unknown>)
              : {}),
            viewDelta,
          },
        };
      }
      return finalResult;
    };

    /**
     * Compute the masked `viewDelta` for a successful `observe` action.
     *
     * NON-navigating verbs (click/type/dblclick/scroll/enter) keep the page
     * context + ref registry, so we re-walk via `diffPageView` (injected together
     * with `buildPageView` — see {@link runDiffInPage}) and SW-mask the added +
     * changed nodes. NAVIGATING verbs (navigate/back/forward/reload) tore down the
     * context, so a diff is meaningless: return a `{navigated:true}` marker with
     * the post-navigation URL (best-effort) so the agent knows to re-snapshot.
     * Best-effort throughout: any failure degrades to an empty/navigated delta —
     * it must never turn a successful action into an error.
     */
    const computeObserveDelta = async (
      tabId: number,
      action: Action,
    ): Promise<PageViewDelta | (PageViewDelta & { note: string })> => {
      if (OBSERVE_NAVIGATING_VERBS.has(action.type)) {
        // Use the post-navigation URL if we can read it; else the action's url
        // (navigate carries one; back/forward/reload don't → fall back to '').
        let url = 'url' in action && typeof action.url === 'string' ? action.url : '';
        try {
          const tab = await chrome.tabs.get(tabId);
          if (tab.url) url = tab.url;
        } catch {
          /* tab gone — keep the action url */
        }
        return {
          // Path-mask: the navigated-to URL can carry a token in its query
          // (?reset_token=…); redact query VALUES before it reaches the agent.
          url: maskUrl(url),
          navigated: true,
          added: [],
          removed: [],
          changed: [],
          truncated: false,
          note: 'refs expired; call get_page_view',
        };
      }
      // Only the known diffable verbs re-walk; an unrecognized `observe`-bearing
      // verb (none today) degrades to an empty delta rather than a bogus diff.
      if (!OBSERVE_DIFFABLE_VERBS.has(action.type)) {
        return { url: '', added: [], removed: [], changed: [], truncated: false };
      }
      // Non-navigating: re-walk + diff in MAIN-world, then SW-mask. We inject
      // `diffPageViewStandalone` (NOT `diffPageView`): it nests `buildPageView`
      // as a real inner function, so it serializes self-contained and runs under
      // the PAGE's CSP with no `new Function`/eval (which MAIN-world CSP blocks).
      try {
        const [frame] = await chrome.scripting.executeScript({
          target: { tabId },
          world: 'MAIN',
          func: diffPageViewStandalone,
          args: [{}],
        });
        const delta = frame?.result as PageViewDelta | undefined;
        if (!delta) {
          return { url: '', added: [], removed: [], changed: [], truncated: false };
        }
        return {
          // Path-mask the delta URL with the SAME scheme as network URLs (a
          // query string can carry a token); origin+path kept, query values gone.
          url: maskUrl(delta.url),
          ...(delta.navigated !== undefined ? { navigated: delta.navigated } : {}),
          added: delta.added.map(maskPageViewNode),
          removed: delta.removed,
          changed: delta.changed.map(maskPageViewNode),
          truncated: delta.truncated,
        };
      } catch {
        // A scripting failure (tab navigated/closed mid-diff) degrades to empty —
        // the action itself already succeeded, so we never surface this as error.
        return { url: '', added: [], removed: [], changed: [], truncated: false };
      }
    };

    /**
     * Surface the Level-3 confirm banner in the side panel and await the user's
     * verdict. Opens the panel for the action's window, posts `showConfirm`,
     * signals the host (`action.confirm.shown`), and waits for a
     * `confirmVerdict`. Fail-closed: a timeout (no user response, or the panel
     * never opened) resolves to deny — per the locked MVP decision, SW death
     * during a pending confirm is also a timeout→deny (the awaiting MCP tool
     * times out).
     */
    const promptUserConfirmation: ActionHandlerDeps['promptUserConfirmation'] = async (input) => {
      const requestId = input.request.requestId;
      const startedAtMs = Date.now();

      // Best-effort open the side panel in the action's window so the user
      // sees the banner. A failure here is non-fatal — the panel may already
      // be open; if it isn't and can't be opened, the timeout fail-closes.
      try {
        const tabId = input.request.tabId;
        const tab =
          tabId !== undefined ? await chrome.tabs.get(tabId).catch(() => undefined) : undefined;
        const windowId = tab?.windowId;
        if (windowId !== undefined) await chrome.sidePanel.open({ windowId });
      } catch (err) {
        console.debug('[peek] sidePanel.open failed (will rely on an open panel):', err);
      }

      const showConfirm: ShowConfirmMessage = {
        type: 'showConfirm',
        requestId,
        action: input.request.action,
        origin: input.origin,
        level: input.effectiveLevel,
        ...(input.destructive.matched && input.destructive.term !== undefined
          ? { destructiveTerm: input.destructive.term }
          : {}),
        ...(input.request.client.length > 0 ? { client: input.request.client } : {}),
      };

      const verdict = await new Promise<ConfirmVerdictMessage>((resolve) => {
        const timer = setTimeout(() => {
          pendingConfirms.delete(requestId);
          resolve({ type: 'confirmVerdict', requestId, verdict: 'deny' });
        }, CONFIRM_TIMEOUT_MS);
        pendingConfirms.set(requestId, { resolve, timer });
        // Post AFTER registering the pending entry so a fast verdict can't race
        // ahead of the map insert. Signal the host for the audit timing too.
        postConfirmShown(requestId);
        chrome.runtime.sendMessage(showConfirm).catch((err) => {
          // No panel listening yet is fine — the panel registers on mount and
          // the SW.open above tries to surface it. If it truly never opens, the
          // timeout fail-closes.
          console.debug('[peek] showConfirm post (panel may be opening):', err);
        });
      });

      const approvalMs = Date.now();
      if (verdict.verdict === 'allow') {
        // "Always for this site" graduates the origin to act-with-confirm
        // (ALWAYS_FOR_SITE_LEVEL = 3) so future actions are still confirmed —
        // it never silently arms Level 4 auto-execute. Best-effort.
        if (verdict.alwaysForSite) {
          void setPermissionLevel(input.origin, ALWAYS_FOR_SITE_LEVEL).catch((err) =>
            console.warn('[peek] alwaysForSite persist failed:', err),
          );
        }
        return { verdict: 'allow', approvalMs, alwaysForSite: verdict.alwaysForSite ?? false };
      }
      // Item F: classify the deny — a no-response timeout, an explicit user Deny
      // click, or a panel close — so the audit log records the real cause
      // instead of mislabeling every non-timeout deny as 'panel-closed'.
      return {
        verdict: 'deny',
        approvalMs,
        reason: denyReason(verdict, approvalMs - startedAtMs, CONFIRM_TIMEOUT_MS),
      };
    };

    /**
     * SP4: Surface the connector-pairing trust-dial prompt in the side panel
     * and await the user's verdict. Mirrors {@link promptUserConfirmation} in
     * structure: open the panel, post `showPair`, register a `pendingPairings`
     * entry + timeout, await the `pairVerdict`.
     *
     * On Approve: mints a high-entropy secret (32 random bytes, base64url),
     * stores ONLY its SHA-256 hash under the derived connectorId, and sends a
     * `pair.result` with `approved:true` + the plaintext secret back to the
     * host. The plaintext is returned exactly once and is NEVER logged.
     *
     * On Deny / timeout: sends `pair.result` with `approved:false` and stores
     * nothing.
     *
     * connectorId derivation: clientName lowercased, runs of non-alphanumeric
     * characters collapsed to a single hyphen, leading/trailing hyphens
     * stripped. Collisions (same derivation) overwrite — latest pairing wins.
     */
    async function handlePairRequest(msg: PairRequestMessage): Promise<void> {
      const { requestId, clientName, code } = msg;

      // Best-effort open the side panel so the user sees the banner.
      try {
        await chrome.sidePanel.open({ windowId: chrome.windows.WINDOW_ID_CURRENT });
      } catch (err) {
        console.debug('[peek] sidePanel.open (pair) failed (will rely on an open panel):', err);
      }

      const showPair: ShowPairMessage = { type: 'showPair', requestId, clientName, code };

      const verdict = await new Promise<PairVerdictMessage>((resolve) => {
        const timer = setTimeout(() => {
          pendingPairings.delete(requestId);
          resolve({ type: 'pairVerdict', requestId, approved: false });
        }, PAIR_TIMEOUT_MS);

        // Register BEFORE posting so a fast verdict can't race ahead of the
        // map insert (mirrors the pendingConfirms pattern).
        pendingPairings.set(requestId, { resolve, timer });
        chrome.runtime.sendMessage(showPair).catch((err) => {
          console.debug('[peek] showPair post (panel may be opening):', err);
        });
      });

      if (!verdict.approved) {
        // Denied or timed out — store nothing.
        const result = { type: 'pair.result' as const, requestId, approved: false };
        const port = nativePort;
        if (port) {
          try {
            port.postMessage(result);
          } catch (err) {
            console.warn('[peek] pair.result (deny) post failed:', err);
          }
        }
        return;
      }

      // Approved: mint a high-entropy secret, hash it, store only the hash.
      const secret = mintPairingSecret();
      const hash = await sha256Hex(secret);
      const connectorId = connectorIdFromClientName(clientName);

      await putPairedConnector(connectorId, { clientName, hash, pairedAtMs: Date.now() }).catch(
        (err) => {
          console.warn('[peek] putPairedConnector failed:', err);
        },
      );

      // Return the plaintext exactly once; the host forwards it to the
      // connector and discards it. Never log the secret.
      const result = { type: 'pair.result' as const, requestId, approved: true, secret };
      const port = nativePort;
      if (port) {
        try {
          port.postMessage(result);
        } catch (err) {
          console.warn('[peek] pair.result (approve) post failed:', err);
        }
      }
    }

    // YOLO grants are anchored to tabs; expire when a tab closes (in addition
    // to the 60-min internal timer). The capture-side tabs.onRemoved below
    // also clears stats/sessions.
    chrome.tabs.onRemoved.addListener((tabId) => {
      yolo.onTabClosed(tabId);
      // Control-shield (Plan A): forget the tab's shield state on close.
      shield.onTabClosed(tabId);
    });

    /**
     * Forward a body to the native host. Best-effort: if the port is down the
     * batch is dropped (the relay's data is best-effort; the keep-alive
     * reconnect will restore the port). Never throws into a message handler.
     */
    function forwardToHost(body: NativeOutbound): boolean {
      const port = nativePort;
      if (!port) return false;
      try {
        port.postMessage(body);
        return true;
      } catch (err) {
        console.warn('[peek] native port postMessage failed:', err);
        return false;
      }
    }

    function connectNative(): void {
      // Idempotency guard: the SW opens the port from three places that can
      // fire close together on a single browser start — the top-level call
      // (every wake), onStartup, and onInstalled. Without this guard each would
      // open a SECOND port (relaunching the native peek-mcp binary) and orphan
      // the previous one, whose later onDisconnect would clobber `nativePort`.
      // One live port at a time.
      if (nativePort !== null) return;

      try {
        nativePort = chrome.runtime.connectNative(NATIVE_HOST_ID);
      } catch (err) {
        // connectNative throws synchronously if the host manifest is missing.
        // Treat as a disconnect and schedule a backed-off retry.
        console.warn('[peek] connectNative threw:', err);
        scheduleReconnect();
        return;
      }
      hostState = 'connected';
      shield.onHostConnectionChanged(true);
      reconnectBackoff = INITIAL_BACKOFF_MS;
      const port = nativePort;
      port.onMessage.addListener(handleHostMessage);
      // Don't reset reconnectAttempts yet (an unregistered host disconnect-
      // storms: connect → immediate onDisconnect). Only clear the stalled-
      // reconnect signal once the port has HELD for CONNECTION_HELD_MS — proof
      // the host is really there and not knocking us straight back to
      // 'reconnecting'. onDisconnect (below) cancels this if it fires first.
      if (connectionHeldTimer !== null) clearTimeout(connectionHeldTimer);
      connectionHeldTimer = setTimeout(() => {
        connectionHeldTimer = null;
        if (nativePort === port) {
          reconnectAttempts = 0;
          // The connection held → this was a real connection. Any future
          // 'reconnecting' is now genuinely a RE-connect.
          hasEverConnected = true;
        }
      }, CONNECTION_HELD_MS);
      port.onDisconnect.addListener(() => {
        // Per Chrome docs: reconnect from the onDisconnect handler, else the
        // SW terminates once timers complete and persistence is lost. Only act
        // if THIS port is still the active one (a stale orphan's late
        // disconnect must not null out a newer port).
        if (nativePort !== port) return;
        console.warn('[peek] native host disconnected:', chrome.runtime.lastError);
        nativePort = null;
        // Cancel the pending "held" reset — this connection did NOT hold, so the
        // failed-attempt count must keep climbing (storm/unregistered host).
        if (connectionHeldTimer !== null) {
          clearTimeout(connectionHeldTimer);
          connectionHeldTimer = null;
        }
        shield.onHostConnectionChanged(false);
        scheduleReconnect();
      });
    }

    function scheduleReconnect(): void {
      hostState = 'reconnecting';
      // Count this failed attempt. A persistently-climbing count (host never
      // registered) is what the side panel reads to surface the setup hint
      // (see isReconnectStalled). Saturate well above the threshold so a host
      // that's down for a very long time can't overflow the counter.
      if (reconnectAttempts < Number.MAX_SAFE_INTEGER) reconnectAttempts += 1;
      // Collapse races: cancel any pending reconnect before arming a new one so
      // multiple disconnects can never queue a storm of independent timers.
      if (reconnectTimer !== null) clearTimeout(reconnectTimer);
      const delay = jitter(reconnectBackoff);
      reconnectTimer = setTimeout(() => {
        reconnectTimer = null;
        connectNative();
      }, delay);
      reconnectBackoff = nextBackoffMs(reconnectBackoff);
    }

    // --- Service-worker lifecycle anchors (ADR-0009) -----------------------
    chrome.runtime.onStartup.addListener(connectNative);
    chrome.runtime.onInstalled.addListener(() => {
      // Side panel opens when the toolbar action is clicked (P2 PRD §A.6).
      chrome.sidePanel
        .setPanelBehavior({ openPanelOnActionClick: true })
        .catch((err) => console.warn('[peek] setPanelBehavior failed:', err));
      connectNative();
    });

    // Top-level call so the port is (re)opened on every SW wake.
    connectNative();
    void reconcileIndicators();

    // --- MAIN-world recorder injection on enabled tabs (Task 3.19) ---------
    // The ISOLATED relay is a static content script (auto-runs at
    // document_start on granted origins). The MAIN-world recorder is injected
    // here when an enabled tab finishes (or starts) loading. We inject on
    // `status === 'loading'` with a committed URL so it lands close to
    // document_start; `injectImmediately` does the rest. isOriginEnabled gates
    // on the user's persisted per-site consent (ADR-0008).
    async function maybeInject(tabId: number, url: string | undefined): Promise<void> {
      const recording = await isTabRecording(url);
      await setTabRecording(tabId, recording);
      if (!recording) return;
      const result = await injectRecorder(tabId);
      if (!result.ok) {
        // Common + benign: the tab navigated away, or the host permission was
        // revoked between the check and the inject. Log at debug volume.
        console.debug('[peek] recorder inject skipped:', result.error);
      }
    }

    chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
      // Inject as early as the URL is committed. Guard on `loading` so we don't
      // re-inject on every minor update; the recorder's own idempotency guard
      // (window.__peekRecorderInstalled) covers a double-fire.
      if (changeInfo.status === 'loading' && tab.url) {
        void maybeInject(tabId, tab.url);
        // Deep-capture attach/detach is keyed on persisted per-origin opt-in
        // (Task 3.26). Sync on each loading event so a fresh-origin
        // navigation reattaches with the right origin's setting.
        void syncDeepCaptureForTab(tabId, tab.url);
      }
    });

    /**
     * P-11 fix (2026-05-28 QA walk): when the side panel enables a NEW
     * origin, inject the MAIN-world recorder into every already-open tab of
     * that origin immediately. Previously the recorder was only injected
     * on `chrome.tabs.onUpdated{status:'loading'}` — meaning enabling a
     * site required a reload before counters started moving and before any
     * events reached the native host. `maybeInject` is internally
     * idempotent (the in-page guard prevents double-init) and `injectRecorder`
     * already returns a safe result on tabs the SW can't reach, so a
     * defensive query over all matching tabs is correct here.
     */
    async function injectIntoEnabledOrigin(origin: string): Promise<void> {
      let tabs: chrome.tabs.Tab[];
      try {
        // Match origin's URL prefix; chrome.tabs.query takes a URL pattern.
        tabs = await chrome.tabs.query({ url: `${origin}/*` });
      } catch (err) {
        console.debug('[peek] tabs.query for added origin failed:', err);
        return;
      }
      for (const tab of tabs) {
        if (tab.id === undefined) continue;
        void maybeInject(tab.id, tab.url);
      }
    }

    // React to side-panel toggle changes immediately. Three responsibilities:
    //  1. (DEEP-CAPTURE ENABLE) Sync the active tab so a fresh-enable starts
    //     Deep capture now.
    //  2. (DEEP-CAPTURE DISABLE) For every origin just REMOVED from Deep
    //     capture, detach EVERY tab of that origin — not only the active one.
    //     Otherwise a user with 3 background tabs of the just-disabled origin
    //     keeps capturing response bodies in those tabs until they activate
    //     one (privacy regression).
    //  3. (ACTIVATION ENABLE — P-11) When `peek:enabledOrigins` gains a new
    //     entry, inject the MAIN-world recorder into every already-open tab
    //     of that origin so live counters and capture both start without
    //     waiting for the user to reload.
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'sync') return;

      // (3) ACTIVATION ENABLE — inject into already-open tabs of newly-added
      // origins so the user sees live capture without reloading (P-11).
      const enabledChange = changes[ENABLED_ORIGINS_KEY];
      if (enabledChange) {
        const added = diffAddedOrigins(enabledChange.oldValue, enabledChange.newValue);
        for (const origin of added) {
          void injectIntoEnabledOrigin(origin);
        }
      }

      // Control-shield (Plan A): a per-origin permission-level change. Fan out
      // to every open tab of the changed origin and let the controller raise/
      // lower. Mirrors injectIntoEnabledOrigin's origin->tabs query.
      const levelChange = changes[PERMISSION_LEVELS_KEY];
      if (levelChange) {
        const oldLevels = (levelChange.oldValue ?? {}) as Record<string, number>;
        const newLevels = (levelChange.newValue ?? {}) as Record<string, number>;
        const origins = new Set([...Object.keys(oldLevels), ...Object.keys(newLevels)]);
        for (const origin of origins) {
          const before = oldLevels[origin] ?? 1;
          const after = newLevels[origin] ?? 1;
          if (before === after) continue;
          const eff = yolo.isActive(origin) ? 4 : after;
          void (async () => {
            let tabs: chrome.tabs.Tab[];
            try {
              tabs = await chrome.tabs.query({ url: `${origin}/*` });
            } catch {
              return;
            }
            for (const tab of tabs) {
              if (tab.id !== undefined) shield.onLevelChanged(tab.id, origin, eff);
            }
          })();
        }
      }

      const change = changes[DEEP_CAPTURE_ORIGINS_KEY];
      if (!change) return;

      // (1) DEEP-CAPTURE ENABLE — re-sync the active tab.
      void chrome.tabs.query({ active: true, lastFocusedWindow: true }).then(([active]) => {
        if (active?.id !== undefined) {
          void syncDeepCaptureForTab(active.id, active.url);
        }
      });

      // (2) DEEP-CAPTURE DISABLE — detach every tab of every removed origin.
      //
      // P-17 (2026-05-29 QA walk): we enumerate via `chrome.tabs.query({})`,
      // NOT the manager's in-memory `#attached` Map. The Map is wiped when
      // the MV3 service worker restarts (every ~30s of inactivity), but
      // Chrome-level debugger attachments survive — so iterating `#attached`
      // missed background tabs after any SW lifecycle event. Querying ALL
      // open tabs and filtering by origin guarantees that every yellow
      // banner for the disabled origin disappears immediately.
      // `chrome.debugger.detach` is idempotent — it throws "Debugger is not
      // attached" for tabs that weren't actually attached, which the
      // manager's `detach()` swallows.
      const removed = diffRemovedOrigins(change.oldValue, change.newValue);
      if (removed.length === 0) return;
      const mgr = deepCapture;
      if (mgr === null) return; // manager never built — nothing attached anyway
      for (const origin of removed) {
        void (async () => {
          const tabs = await chrome.tabs.query({});
          const tabIds: number[] = [];
          for (const t of tabs) {
            if (typeof t.id !== 'number' || !t.url) continue;
            try {
              if (originFromUrl(t.url) === origin) tabIds.push(t.id);
            } catch {
              // unparseable URL (chrome://, about:blank, etc.) — skip
            }
          }
          await mgr.detachOrigin(origin, tabIds);
        })();
      }
    });

    // --- Tab teardown ------------------------------------------------------
    chrome.tabs.onRemoved.addListener((tabId) => {
      stats.clear(tabId);
      sessions.clear(tabId);
      recordingState.clear(tabId);
      // Detach the debugger from a closed tab (best-effort — Chrome may
      // have already auto-detached on close). The manager is idempotent
      // for the unattached case.
      if (deepCapture !== null) {
        void deepCapture.detach(tabId);
      }
    });

    // --- Message router ----------------------------------------------------
    chrome.runtime.onMessage.addListener(
      (message: Cmd | ConfirmVerdictMessage, sender, sendResponse: (response: unknown) => void) => {
        // Reject messages from other extensions / web pages.
        if (sender.id !== chrome.runtime.id) {
          return false;
        }
        // Control-shield (Plan A): view -> SW handshake / Stop. Hardened sender
        // trust to the confirmVerdict-grade standard (design §6/§9): must be our
        // extension (checked above), a real tab, the top frame, AND the sender
        // frame's origin must be at effective Level >= 4 — the same trust bar a
        // shielded action clears. A subframe or tab-less context can't drive the
        // shield, and a non-Level-4 origin (e.g. a stale view after the dial was
        // lowered, or a same-extension page that isn't the shield) can't stop/
        // resume/ready another origin's handoff. The router's static param type
        // doesn't list ShieldInbound, so guard through `unknown` to narrow
        // cleanly (the message arrives at runtime).
        if (isShieldInbound(message as unknown)) {
          const shieldMessage = message as unknown as ShieldInbound;
          const tabId = sender.tab?.id;
          if (tabId === undefined || sender.frameId !== 0) return false;
          const origin = originFromUrl(sender.tab?.url ?? null);
          if (!origin) return false;
          // Effective-level gate is async (storage.sync read), so structure it
          // like the other async-gated branches: resolve the level, drop the
          // message if it's below 4, otherwise route. Mirrors the controller's
          // getEffectiveLevel dep (yolo overrides persistent at L4).
          void (async () => {
            const effectiveLevel = yolo.isActive(origin) ? 4 : await getPermissionLevel(origin);
            if (effectiveLevel < 4) return;
            if (shieldMessage.type === 'shield.stop') {
              void shield.onStop(tabId);
            } else if (shieldMessage.type === 'shield.ready') {
              void shield.onViewReady(tabId, origin, shieldMessage.generation);
            } else if (shieldMessage.type === 'shield.resume') {
              // Plan B: the user finished the handoff in the view. Forward an
              // optional value (readBack honored controller-side; never echoed
              // for password/OTP/cc). No-op if no handoff is pending (SW-restart
              // safe).
              shield.onUserResume(
                tabId,
                shieldMessage.value !== undefined ? { value: shieldMessage.value } : undefined,
              );
            }
          })();
          return false;
        }
        // Level-3 confirm verdict from the side panel (Phase 3e). Resolve the
        // awaiting promptUserConfirmation; the gate then dispatches or denies.
        //
        // Item C: a verdict must come from the extension's OWN side panel, not
        // any other extension-origin context (options/popup/devtools), which
        // could otherwise approve a pending action — and silently escalate via
        // alwaysForSite. The sender.id check above isn't sufficient; require the
        // sidepanel page URL too. A rejected verdict is dropped (the SW's
        // confirm timeout still fail-closes the pending action).
        if (message?.type === 'confirmVerdict') {
          if (isFromSidePanel(sender, chrome.runtime.getURL('sidepanel.html'))) {
            resolvePendingConfirm(message);
            sendResponse(ackOk());
          } else {
            console.warn('[peek] confirmVerdict from a non-sidepanel sender rejected:', sender.url);
            sendResponse({ ok: false, reason: 'not-from-sidepanel' });
          }
          return false;
        }
        // SP4: pairing verdict from the side panel. Same origin-guard as
        // confirmVerdict — only the extension's OWN side panel may approve or
        // deny a pairing. A rejected verdict is dropped; the SW timeout
        // fail-closes the pending handlePairRequest.
        if (isPairVerdict(message as unknown)) {
          const verdict = message as unknown as PairVerdictMessage;
          if (isFromSidePanel(sender, chrome.runtime.getURL('sidepanel.html'))) {
            resolvePendingPairing(verdict);
            sendResponse(ackOk());
          } else {
            console.warn('[peek] pairVerdict from a non-sidepanel sender rejected:', sender.url);
            sendResponse({ ok: false, reason: 'not-from-sidepanel' });
          }
          return false;
        }
        // SP4 Task 7: revoke a paired connector. Same origin-guard as
        // pairVerdict — only the extension's OWN side panel may revoke a
        // pairing. Deletes the stored hash; that connector's next act-
        // verification fails and falls back to the local banner. A rejected
        // message (non-sidepanel sender or malformed) is dropped silently.
        if (isRevokePairing(message as unknown)) {
          if (isFromSidePanel(sender, chrome.runtime.getURL('sidepanel.html'))) {
            const { connectorId } = message as unknown as RevokePairingMessage;
            // Await the storage write before acking — the side panel re-reads
            // immediately after and a fire-and-forget sendResponse races the clear.
            clearPairedConnector(connectorId)
              .then(() => sendResponse(ackOk()))
              .catch((err) => {
                console.warn('[peek] clearPairedConnector failed:', err);
                sendResponse({ ok: false, reason: 'clear-failed' });
              });
          } else {
            console.warn('[peek] revokePairing from a non-sidepanel sender rejected:', sender.url);
            sendResponse({ ok: false, reason: 'not-from-sidepanel' });
          }
          // Return true: the response channel must stay open for the async ack above.
          return true;
        }
        switch (message?.type) {
          case 'getNativeHostState': {
            const response: CmdResponse<{ type: 'getNativeHostState' }> = {
              state: hostState,
              reconnectAttempts,
              hasEverConnected,
            };
            sendResponse(response);
            return false;
          }
          case 'getRecordingState': {
            const tabId = sender.tab?.id;
            const response: CmdResponse<{ type: 'getRecordingState' }> = {
              recording: tabId !== undefined ? recordingState.get(tabId) : false,
            };
            sendResponse(response);
            return false;
          }
          case 'getRecorderStats': {
            const response: CmdResponse<{ type: 'getRecorderStats'; tabId: number }> = stats.get(
              message.tabId,
            );
            sendResponse(response);
            return false;
          }
          case 'activateRecorderForTab': {
            // Side panel just got a per-tab (or per-origin) host grant for this
            // tab. Neither tabs.onUpdated{loading} (no navigation) nor
            // storage.onChanged (the 'tab' scope persists nothing) will fire,
            // so the recorder would never get injected without this explicit
            // path. The in-page guard (`window.__peekRecorderInstalled`) makes
            // a double-inject safe.
            void injectRecorder(message.tabId).then((result) => {
              if (result.ok) {
                void setTabRecording(message.tabId, true);
              } else {
                console.debug('[peek] activateRecorderForTab inject failed:', result.error);
              }
              const response: CmdResponse<{ type: 'activateRecorderForTab'; tabId: number }> = {
                ok: result.ok,
                ...(result.error ? { reason: result.error } : {}),
              };
              sendResponse(response);
            });
            return true; // async sendResponse
          }
          case 'recorder.events': {
            handleRelayEvents(message, sender);
            sendResponse(ackOk());
            return false;
          }
          case 'recorder.shadow': {
            handleRelayShadow(message, sender);
            sendResponse(ackOk());
            return false;
          }
          default:
            return false;
        }
      },
    );

    // --- Relay batch handlers (ISOLATED relay → SW → native host) ----------
    // The relay already MASKED these (the privacy boundary is upstream, in the
    // content script). Here we fold per-tab stats for the side panel and
    // forward to the native host. `sender.tab?.id` is the trusted tab id (the
    // relay can't forge it — Chrome stamps it). A message with no tab id can't
    // be a relay content script; ignore it.
    //
    // 3d-3 NOTE: permission-level gating slots in right here — gate the
    // forwardToHost() calls (and/or stats folding) on the per-origin level the
    // SW will read. For this chunk, recording forwards whenever a site is
    // enabled.

    function handleRelayEvents(
      message: Extract<Cmd, { type: 'recorder.events' }>,
      sender: chrome.runtime.MessageSender,
    ): void {
      const tabId = sender.tab?.id;
      if (tabId === undefined) return;
      stats.addEvents(tabId, message.events.length, message.console.length);
      const ref = sessions.ensure(tabId, { url: sender.tab?.url, title: sender.tab?.title });

      // Plan B recording-suspension (SW-side seam): while this tab is in a
      // handoff the user is typing into the page, so DROP the rrweb forward —
      // defense-in-depth, do not record/forward their keystrokes. Console events
      // ride a separate channel below and are unaffected. NOTE: this closes the
      // INCREMENTAL channel only; a value the user LEAVES in a field is still
      // captured by rrweb's next FullSnapshot (design §9 channel-3 — documented).
      if (!shield.isHandoff(tabId)) {
        if (message.events.length > 0) forwardToHost(sessionAppend(ref, message.events));

        // alpha.6 (Phase 5 task #72): the network plugin emits its events through
        // the rrweb event stream (`recorder.events`), not the legacy `recorder.net`
        // channel. Walk the batch for `EventType.Plugin` / `rrweb/network@1` events
        // and synthesize legacy `NetMessage` envelopes onto `network.append` so
        // peek-mcp's `network_events` table + the `get_session_network_errors`
        // MCP tool keep working unchanged. DOUBLE-WRITE: the plugin events also
        // stay in the rrweb stream (above), preserving the data for the future
        // read-path migration (alpha.10+) that walks the stream directly. Remove
        // this synth call when that migration lands — see comment block in
        // src/background/network-plugin-synth.ts for the removal trigger.
        // Derived from the same rrweb stream, so it is suspended with it.
        if (message.events.length > 0) {
          const synth = synthesizeNetMessagesFromEvents(message.events);
          if (synth.length > 0) {
            // Count opens for the side panel — keep the legacy semantic of
            // counting `request` envelopes (the live counter shouldn't change
            // shape just because the capture mechanism did).
            const opens = synth.filter((r) => r.kind === 'request').length;
            if (opens > 0) stats.addNetwork(tabId, opens);
            forwardToHost(networkAppend(ref, synth));
          }
        }
      }

      // Console forwarding stays UNCONDITIONAL — a separate channel, not the
      // page's keystroke surface (design §9: console is unaffected by handoff).
      if (message.console.length > 0) forwardToHost(consoleAppend(ref, message.console));
    }

    function handleRelayShadow(
      message: Extract<Cmd, { type: 'recorder.shadow' }>,
      sender: chrome.runtime.MessageSender,
    ): void {
      const tabId = sender.tab?.id;
      if (tabId === undefined) return;
      const ref = sessions.ensure(tabId, { url: sender.tab?.url, title: sender.tab?.title });
      if (message.reports.length > 0) forwardToHost(shadowReport(ref, message.reports));
    }

    function ackOk(): RelayAck {
      return { ok: true };
    }
  },
});
