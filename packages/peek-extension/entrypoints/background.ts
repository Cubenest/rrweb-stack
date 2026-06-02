import { defineBackground } from 'wxt/utils/define-background';
import { originFromUrl } from '../src/activation/origin';
import { diffAddedOrigins, isOriginEnabled } from '../src/activation/storage';
import { INITIAL_BACKOFF_MS, jitter, nextBackoffMs } from '../src/background/backoff';
import {
  type NativeOutbound,
  consoleAppend,
  networkAppend,
  sessionAppend,
  shadowReport,
} from '../src/background/native-protocol';
import { synthesizeNetMessagesFromEvents } from '../src/background/network-plugin-synth';
import { SessionRegistry } from '../src/background/session';
import { RecorderStatsStore } from '../src/background/stats';
import { ENABLED_ORIGINS_KEY, NATIVE_HOST_ID } from '../src/constants';
import {
  DEEP_CAPTURE_ORIGINS_KEY,
  DeepCaptureManager,
  buildChromeDebuggerSurface,
  diffRemovedOrigins,
  isDeepCaptureEnabled,
} from '../src/deep-capture';
import type {
  Cmd,
  CmdResponse,
  ConfirmVerdictMessage,
  NativeHostState,
  RelayAck,
  ShowConfirmMessage,
} from '../src/messaging/protocol';
import { denyReason, isFromSidePanel } from '../src/messaging/protocol';
import {
  type ActionHandlerDeps,
  InMemoryConfirmTokenStore,
  handleActionRequest,
} from '../src/permissions/action-handler';
import type { ActionResultMessage } from '../src/permissions/action-protocol';
import { isActionRequest } from '../src/permissions/action-protocol';
import {
  dispatchAction,
  resolveTarget as resolveTargetInPage,
} from '../src/permissions/dispatcher';
import { getPermissionLevel, setPermissionLevel } from '../src/permissions/store';
import { YoloSessionStore } from '../src/permissions/yolo';
import { injectRecorder } from '../src/recorder/inject';

/** Fail-closed timeout for a pending Level-3 confirm (locked MVP decision). */
const CONFIRM_TIMEOUT_MS = 2 * 60_000;

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
    // Single pending reconnect timer. Holding the handle lets us collapse all
    // disconnect/wake races into ONE pending reconnect (see scheduleReconnect).
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

    // Per-tab capture state (3d-2). Lives only in this SW instance; if the SW is
    // torn down the counts reset — acceptable, the side panel re-polls and the
    // native host owns durable state.
    const stats = new RecorderStatsStore();
    const sessions = new SessionRegistry();

    // Permission state (3d-3). Both in-memory + scoped to this SW instance.
    const yolo = new YoloSessionStore();
    const confirmTokens = new InMemoryConfirmTokenStore();

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
      const selector = 'selector' in action ? action.selector : undefined;
      if (typeof selector !== 'string' || selector.length === 0) return {};
      // Item B: thread `nth` so the destructive matcher inspects the SAME
      // element the dispatcher will click (`querySelectorAll(selector)[nth]`).
      // Only the click branch carries `nth`; for everything else it's undefined
      // → first match, matching dispatchAction.
      const nth = 'nth' in action && typeof action.nth === 'number' ? action.nth : undefined;
      try {
        const [frame] = await chrome.scripting.executeScript({
          target: { tabId },
          world: 'MAIN',
          func: resolveTargetInPage,
          args: [selector, nth],
        });
        return (frame?.result as Awaited<ReturnType<typeof resolveTargetInPage>>) ?? {};
      } catch (err) {
        console.debug('[peek] resolveTarget MAIN-world script failed:', err);
        return {};
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
        return result ?? { ok: false, error: 'no result from MAIN-world dispatch' };
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
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
        ...(input.destructive.matched && input.destructive.term !== undefined
          ? { destructiveTerm: input.destructive.term }
          : {}),
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
        // "Always for this site" persists the origin to Level 4 so future
        // actions on this origin auto-allow (non-destructive). Best-effort.
        if (verdict.alwaysForSite) {
          void setPermissionLevel(input.origin, 4).catch((err) =>
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

    // YOLO grants are anchored to tabs; expire when a tab closes (in addition
    // to the 60-min internal timer). The capture-side tabs.onRemoved below
    // also clears stats/sessions.
    chrome.tabs.onRemoved.addListener((tabId) => {
      yolo.onTabClosed(tabId);
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
      reconnectBackoff = INITIAL_BACKOFF_MS;
      const port = nativePort;
      port.onMessage.addListener(handleHostMessage);
      port.onDisconnect.addListener(() => {
        // Per Chrome docs: reconnect from the onDisconnect handler, else the
        // SW terminates once timers complete and persistence is lost. Only act
        // if THIS port is still the active one (a stale orphan's late
        // disconnect must not null out a newer port).
        if (nativePort !== port) return;
        console.warn('[peek] native host disconnected:', chrome.runtime.lastError);
        nativePort = null;
        scheduleReconnect();
      });
    }

    function scheduleReconnect(): void {
      hostState = 'reconnecting';
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

    // --- MAIN-world recorder injection on enabled tabs (Task 3.19) ---------
    // The ISOLATED relay is a static content script (auto-runs at
    // document_start on granted origins). The MAIN-world recorder is injected
    // here when an enabled tab finishes (or starts) loading. We inject on
    // `status === 'loading'` with a committed URL so it lands close to
    // document_start; `injectImmediately` does the rest. isOriginEnabled gates
    // on the user's persisted per-site consent (ADR-0008).
    async function maybeInject(tabId: number, url: string | undefined): Promise<void> {
      if (!url) return;
      try {
        if (!(await isOriginEnabled(url))) return;
        // Level 0 = Off: ADR-0010 says the tool surface is disabled AND
        // recording is suppressed on the site. Bail before injecting.
        const origin = originFromUrl(url);
        if (origin !== null && (await getPermissionLevel(origin)) === 0) return;
      } catch {
        return; // storage read failed — skip, try again on the next event
      }
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
        switch (message?.type) {
          case 'getNativeHostState': {
            const response: CmdResponse<{ type: 'getNativeHostState' }> = {
              state: hostState,
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
              if (!result.ok) {
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
      if (message.events.length > 0) forwardToHost(sessionAppend(ref, message.events));
      if (message.console.length > 0) forwardToHost(consoleAppend(ref, message.console));

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
