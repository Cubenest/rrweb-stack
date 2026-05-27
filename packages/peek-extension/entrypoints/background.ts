import { defineBackground } from 'wxt/utils/define-background';
import { INITIAL_BACKOFF_MS, jitter, nextBackoffMs } from '../src/background/backoff';
import { NATIVE_HOST_ID } from '../src/constants';
import {
  type Cmd,
  type CmdResponse,
  EMPTY_RECORDER_STATS,
  type NativeHostState,
} from '../src/messaging/protocol';

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
 *   - 3d-1 (this chunk): the keep-alive anchor + side-panel behavior + a
 *     message router stub.
 *   - 3d-2: handle recorder relay messages, track per-tab RecorderStats.
 *   - 3d-3: native-host request/response for action execution + audit.
 */
export default defineBackground({
  type: 'module',
  main() {
    let nativePort: chrome.runtime.Port | null = null;
    let reconnectBackoff = INITIAL_BACKOFF_MS;
    let hostState: NativeHostState = 'disconnected';

    function handleHostMessage(message: unknown): void {
      // Native-host → extension messages. Wired in 3d-3 (action results,
      // ack/nack). For now we only need the read activity to reset the SW
      // idle timer, which receiving a message already does.
      void message;
    }

    function connectNative(): void {
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
      nativePort.onMessage.addListener(handleHostMessage);
      nativePort.onDisconnect.addListener(() => {
        // Per Chrome docs: reconnect from the onDisconnect handler, else the
        // SW terminates once timers complete and persistence is lost.
        console.warn('[peek] native host disconnected:', chrome.runtime.lastError);
        nativePort = null;
        scheduleReconnect();
      });
    }

    function scheduleReconnect(): void {
      hostState = 'reconnecting';
      const delay = jitter(reconnectBackoff);
      setTimeout(connectNative, delay);
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
            // Placeholder until the recorder relay lands (3d-2): always zero.
            const response: CmdResponse<{ type: 'getRecorderStats'; tabId: number }> =
              EMPTY_RECORDER_STATS;
            sendResponse(response);
            return false;
          }
          default:
            return false;
        }
      },
    );
  },
});
