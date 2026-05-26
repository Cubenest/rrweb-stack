// Screenshot fallback interface — Task 1.6.
//
// ADR-0002: when rrweb misbehaves on hard sites (canvas/webgl heavy, hostile
// CSS, very large DOMs throttled out of full-fidelity capture), a periodic
// screenshot keeps the recording useful for triage. Both products consume
// the same `ScreenshotAdapter` contract; the transport differs:
//
//   - P1/tracelane → CDP `Page.captureScreenshot` via a WebDriver-supplied
//     CDP session (see `createCDPScreenshotAdapter`).
//   - P2/peek     → `chrome.tabs.captureVisibleTab` from the extension
//     service worker (see `createTabsScreenshotAdapter`).
//
// The substrate stays environment-agnostic by injecting the transport as a
// parameter rather than importing `chrome.*` or any CDP client library.
// Tests at this layer cover the contract; real-environment integration
// tests live in the product packages.

/**
 * Capture the visible viewport as PNG (or JPEG, if the factory was
 * configured with `format: 'jpeg'`) bytes.
 *
 * The bytes are the raw image payload — callers can persist directly, embed
 * via `data:image/<fmt>;base64,...` URLs, or stream into a video assembler.
 * No framing, no envelope.
 */
export interface ScreenshotAdapter {
  /**
   * Capture the visible viewport. Resolves to a Uint8Array of image bytes
   * in the format configured at factory time (PNG by default).
   *
   * Rejections propagate the transport error verbatim — the substrate does
   * not retry, throttle, or wrap. The caller decides whether a missed
   * frame is recoverable.
   */
  capture(): Promise<Uint8Array>;

  /**
   * Optional cleanup hook. The reference adapters resolve immediately — the
   * field exists so product-specific adapters that *do* hold listeners
   * (e.g. a long-lived CDP event subscription) can be torn down without a
   * contract change.
   */
  dispose?(): Promise<void>;
}
