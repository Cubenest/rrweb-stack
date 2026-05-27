// CDP screenshot adapter — Task 1.6.
//
// Wraps a caller-supplied CDP transport and exposes the `ScreenshotAdapter`
// surface. Used by P1/tracelane against the WebDriver-supplied CDP session
// (every framework adapter — `@tracelane/wdio`, `@tracelane/playwright`,
// `@tracelane/cypress` — converges on a `cdp(domain, command, params)` shim
// per P1 PRD §A, and our factory talks to that shim through the
// `CDPTransport` shape below).
//
// Why injection-by-parameter (rather than `import { CDP } from 'chrome-remote-interface'`):
// it keeps the substrate environment-agnostic and lets each framework
// reuse the CDP session it *already* has — re-attaching a second client
// would duplicate event streams and consume a connection slot. The
// transport is structural: anything with `.send(method, params)` returning
// a Promise will do.
//
// We deliberately do not implement retry, throttling, or queueing. The
// caller schedules captures (typically 0.2-1 Hz per ADR-0002's screenshot
// fallback note), and a single in-flight rejection propagates verbatim.

import { decodeBase64 } from './base64.js';
import type { ScreenshotAdapter } from './types.js';

/**
 * Structural shape of a CDP transport — typically a thin wrapper around
 * `chrome-remote-interface`, a WebDriver CDP bridge (e.g.
 * `browser.cdp` in WDIO), or Playwright's `CDPSession.send`.
 *
 * The factory only calls `.send`; emitting events back is the consumer's
 * problem and lives outside this contract.
 */
export interface CDPTransport {
  send(method: string, params?: Record<string, unknown>): Promise<unknown>;
}

/**
 * Factory-time options for the CDP screenshot adapter. All fields map
 * directly onto the [`Page.captureScreenshot`][cdp] parameters; defaults
 * are applied at `capture()` time, not at factory time, so a single adapter
 * can be reused across captures without mutation.
 *
 * [cdp]: https://chromedevtools.github.io/devtools-protocol/tot/Page/#method-captureScreenshot
 */
export interface CDPScreenshotOptions {
  /** PNG (default) or JPEG. JPEG is smaller but lossy. */
  format?: 'png' | 'jpeg';
  /** 0-100. Only meaningful when `format === 'jpeg'`; CDP ignores it for PNG. */
  quality?: number;
  /**
   * `true` (default) — capture from the render surface, bypassing window
   * compositing and avoiding the OS cursor. `false` mirrors a screen grab.
   */
  fromSurface?: boolean;
  /**
   * When `true`, capture the full scrollable area, not just the viewport.
   * Defaults to `false` because the contract is "the visible viewport" and
   * full-page captures are dramatically larger.
   */
  captureBeyondViewport?: boolean;
}

/**
 * Build a `ScreenshotAdapter` that captures via CDP `Page.captureScreenshot`.
 *
 * The returned adapter is stateless beyond its closure: it can be called
 * concurrently, and `dispose()` is a no-op (the transport's lifecycle is
 * owned by the caller).
 *
 * @param transport Any object that can `.send('Page.captureScreenshot', …)`.
 * @param options Factory-time defaults; `capture()` forwards them as
 *                CDP params.
 */
export function createCDPScreenshotAdapter(
  transport: CDPTransport,
  options: CDPScreenshotOptions = {},
): ScreenshotAdapter {
  const format = options.format ?? 'png';
  const fromSurface = options.fromSurface ?? true;
  const captureBeyondViewport = options.captureBeyondViewport ?? false;
  // `quality` is left undefined unless explicitly set — CDP rejects unknown
  // undefineds in some language bindings, and the param is meaningful only
  // for JPEG anyway.
  const quality = options.quality;

  return {
    async capture(): Promise<Uint8Array> {
      const params: Record<string, unknown> = {
        format,
        fromSurface,
        captureBeyondViewport,
      };
      if (quality !== undefined) {
        params.quality = quality;
      }

      const reply = (await transport.send('Page.captureScreenshot', params)) as
        | { data?: unknown }
        | null
        | undefined;

      const data = reply && typeof reply === 'object' ? reply.data : undefined;
      if (typeof data !== 'string') {
        const got = data === undefined ? 'undefined' : typeof data;
        throw new Error(`Page.captureScreenshot returned no base64 \`data\` field — got ${got}`);
      }

      return decodeBase64(data);
    },
    async dispose(): Promise<void> {
      // The transport lifecycle is owned by the caller — there is nothing
      // for the substrate to release. The hook stays present for symmetry
      // with adapters that *do* hold subscriptions.
    },
  };
}
