// chrome.tabs.captureVisibleTab adapter — Task 1.6.
//
// Used by P2/peek from the extension service worker. The MV3 service worker
// has access to `chrome.tabs.captureVisibleTab(windowId?, options?)`, which
// returns a `data:image/<fmt>;base64,...` URL. We accept the function as a
// parameter rather than reading `chrome.tabs` off a global so the substrate
// stays environment-agnostic and trivially testable.
//
// The function's argument ergonomics (windowId first, options second) match
// the Chrome API exactly — when no windowId is configured the factory
// passes `undefined`, mirroring `chrome.tabs.captureVisibleTab(undefined, opts)`,
// which the API treats as "the current window".
//
// Why not just `globalThis.chrome?.tabs?.captureVisibleTab`: (1) we want
// the substrate to typecheck and bundle outside an extension context;
// (2) callers often want to wrap the call with permission checks or
// telemetry; (3) tests stay synchronous-fixture-friendly.

import { decodeBase64 } from './base64';
import type { ScreenshotAdapter } from './types';

/**
 * Structural shape of `chrome.tabs.captureVisibleTab`. The Chrome API
 * resolves to a `data:image/<fmt>;base64,...` URL (or an empty string on
 * failure in older Chromium builds — handled below).
 *
 * The argument order matches the Chrome API: `(windowId?, options?)`.
 * Passing `undefined` for `windowId` selects the current window.
 */
export type CaptureVisibleTabFn = (
  windowId?: number,
  options?: { format?: 'png' | 'jpeg'; quality?: number },
) => Promise<string>;

/**
 * Factory-time options for the tabs screenshot adapter. `windowId` is
 * passed through verbatim; `format` and `quality` are forwarded to the
 * Chrome API's `options` bag.
 */
export interface TabsScreenshotOptions {
  /**
   * The browser window to capture from. Defaults to `undefined`, which the
   * Chrome API interprets as "the currently focused window".
   */
  windowId?: number;
  /** PNG (default) or JPEG. */
  format?: 'png' | 'jpeg';
  /** 0-100. JPEG only; Chrome ignores it for PNG. */
  quality?: number;
}

/**
 * Build a `ScreenshotAdapter` that captures via `chrome.tabs.captureVisibleTab`.
 *
 * The factory takes the `captureVisibleTab` reference as a parameter so the
 * substrate is not coupled to the `chrome.*` namespace — pass
 * `chrome.tabs.captureVisibleTab.bind(chrome.tabs)` from the extension
 * service worker.
 *
 * The returned adapter is stateless; `dispose()` is a no-op.
 *
 * @param captureVisibleTab A function with the `chrome.tabs.captureVisibleTab` shape.
 * @param options Factory-time defaults.
 */
export function createTabsScreenshotAdapter(
  captureVisibleTab: CaptureVisibleTabFn,
  options: TabsScreenshotOptions = {},
): ScreenshotAdapter {
  const windowId = options.windowId;
  const format = options.format ?? 'png';
  const quality = options.quality;

  return {
    async capture(): Promise<Uint8Array> {
      const tabOptions: { format: 'png' | 'jpeg'; quality?: number } = { format };
      if (quality !== undefined) {
        tabOptions.quality = quality;
      }

      const dataUrl = await captureVisibleTab(windowId, tabOptions);

      if (typeof dataUrl !== 'string' || dataUrl.length === 0) {
        // Chrome historically resolved with an empty string on permission
        // failures rather than rejecting; surface that as a useful error.
        throw new Error('chrome.tabs.captureVisibleTab returned an empty result');
      }

      // Expected shape: `data:image/png;base64,AAAA…` — but we accept any
      // mime-type, only the `;base64,` segment matters for decoding.
      const marker = ';base64,';
      const idx = dataUrl.indexOf(marker);
      if (idx === -1) {
        throw new Error(
          'captureVisibleTab result is not a base64-encoded data URL (missing `;base64,` segment)',
        );
      }

      const payload = dataUrl.slice(idx + marker.length);
      return decodeBase64(payload);
    },
    async dispose(): Promise<void> {
      // No listeners or session state to release.
    },
  };
}
