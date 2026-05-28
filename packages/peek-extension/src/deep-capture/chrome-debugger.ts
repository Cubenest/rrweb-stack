/**
 * Production adapter: bridges `chrome.debugger.*` to the `DebuggerSurface`
 * interface DeepCaptureManager depends on. Kept as a thin shim so the
 * manager's unit tests stay free of any `chrome.*` access.
 *
 * The MV3 `chrome.debugger.*` API is promise-flavoured in Chrome ≥104; the
 * extension's `minimum_chrome_version` is 116 so we use the Promise form.
 * The `chrome.debugger.onEvent` listener takes a 3-arity callback
 * `(source, method, params)`, where `source` is `{ tabId?, extensionId? }`.
 */

import type { DebuggeeTab, DebuggerSurface } from './manager.js';

/** Build a DebuggerSurface around the real `chrome.debugger.*` namespace. */
export function buildChromeDebuggerSurface(): DebuggerSurface {
  return {
    async attach(target, protocolVersion) {
      await chrome.debugger.attach({ tabId: target.tabId }, protocolVersion);
    },
    async detach(target) {
      await chrome.debugger.detach({ tabId: target.tabId });
    },
    async sendCommand(target, method, params) {
      // chrome.debugger.sendCommand returns the protocol method's result
      // object; we trust the manager to know the right shape per method.
      const result = await chrome.debugger.sendCommand(
        { tabId: target.tabId },
        method,
        params ?? {},
      );
      return result as never;
    },
    onEvent(listener) {
      const wrapped = (source: chrome.debugger.Debuggee, method: string, params?: object): void => {
        const tabId = source.tabId;
        if (tabId === undefined) return;
        const tab: DebuggeeTab = { tabId };
        listener(tab, method, params);
      };
      chrome.debugger.onEvent.addListener(wrapped);
      return () => chrome.debugger.onEvent.removeListener(wrapped);
    },
  };
}
