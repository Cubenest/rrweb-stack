import { defineBackground } from 'wxt/utils/define-background';
import { originFromUrl } from '../src/activation/origin';
import { isOriginEnabled } from '../src/activation/storage';
import { INITIAL_BACKOFF_MS, jitter, nextBackoffMs } from '../src/background/backoff';
import {
  type NativeOutbound,
  consoleAppend,
  networkAppend,
  sessionAppend,
  shadowReport,
} from '../src/background/native-protocol';
import { SessionRegistry } from '../src/background/session';
import { RecorderStatsStore } from '../src/background/stats';
import { NATIVE_HOST_ID } from '../src/constants';
import type { Cmd, CmdResponse, NativeHostState, RelayAck } from '../src/messaging/protocol';
import { InMemoryConfirmTokenStore, handleActionRequest } from '../src/permissions/action-handler';
import type { ActionResultMessage } from '../src/permissions/action-protocol';
import { isActionRequest } from '../src/permissions/action-protocol';
import { getPermissionLevel } from '../src/permissions/store';
import { YoloSessionStore } from '../src/permissions/yolo';
import { injectRecorder } from '../src/recorder/inject';

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
          yolo,
          tokens: confirmTokens,
          // The MAIN-world banner UX + selector resolution + dispatch are
          // E2E-deferred — the brief calls them out as "the actual
          // chrome.scripting MAIN dispatch + the React banner UX are E2E
          // (Phase 3e)". Wire safe defaults that fail-closed so a user who
          // gets here at Level 3 sees a structured deny (no banner yet) and
          // the audit log still records it.
          async promptUserConfirmation() {
            return {
              verdict: 'deny',
              approvalMs: Date.now(),
              reason: 'panel-closed',
            };
          },
          async resolveTarget() {
            // No MAIN-world resolver wired yet; an empty target means the
            // destructive matcher won't fire. Acceptable: a Level-3 action
            // still confirms (every action prompts); a Level-4 action will
            // skip the override (no destructive term resolved) — when the
            // dispatcher lands it will populate target before the gate runs.
            return {};
          },
          async dispatchInMainWorld() {
            return { ok: false, error: 'MAIN-world dispatcher not wired (Phase 3e)' };
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
      }
    });

    // --- Tab teardown ------------------------------------------------------
    chrome.tabs.onRemoved.addListener((tabId) => {
      stats.clear(tabId);
      sessions.clear(tabId);
    });

    // --- Message router ----------------------------------------------------
    chrome.runtime.onMessage.addListener(
      (message: Cmd, sender, sendResponse: (response: unknown) => void) => {
        // Reject messages from other extensions / web pages.
        if (sender.id !== chrome.runtime.id) {
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
          case 'recorder.events': {
            handleRelayEvents(message, sender);
            sendResponse(ackOk());
            return false;
          }
          case 'recorder.net': {
            handleRelayNet(message, sender);
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
    }

    function handleRelayNet(
      message: Extract<Cmd, { type: 'recorder.net' }>,
      sender: chrome.runtime.MessageSender,
    ): void {
      const tabId = sender.tab?.id;
      if (tabId === undefined) return;
      const requests = message.records.filter((r) => r.kind === 'request').length;
      stats.addNetwork(tabId, requests);
      const ref = sessions.ensure(tabId, { url: sender.tab?.url, title: sender.tab?.title });
      if (message.records.length > 0) forwardToHost(networkAppend(ref, message.records));
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
