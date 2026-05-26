// Screenshot fallback interface — Task 1.6 test suite.
//
// The substrate ships ONE interface (`ScreenshotAdapter`) and TWO factories
// that inject a product-specific capture path:
//
//   - createCDPScreenshotAdapter — CDP `Page.captureScreenshot`, used by
//     P1/tracelane via a WebDriver BiDi / CDP transport supplied at runtime.
//   - createTabsScreenshotAdapter — `chrome.tabs.captureVisibleTab`, used by
//     P2/peek from the extension service worker.
//
// Tests here only cover the substrate's contract — that the right method is
// called with the right params, results are decoded correctly, and obvious
// edge cases fail loudly. Real-environment integration tests live in the
// product packages (per IMPLEMENTATION_PLAN.md Task 1.6: "implementation
// tests deferred to product packages").
//
// We use platform-native `atob` to construct fixture base64 → bytes so the
// tests assert the same encoding pipeline the adapters use.

import { describe, expect, test, vi } from 'vitest';
import {
  type CDPTransport,
  type CaptureVisibleTabFn,
  createCDPScreenshotAdapter,
  createTabsScreenshotAdapter,
} from '../src/screenshot';

// ────────────────────────────────────────────────────────────────────────────
// Fixture helpers
// ────────────────────────────────────────────────────────────────────────────

/** Build a base64 string of the given bytes (test-side, mirrors the encoder). */
function bytesToBase64(bytes: Uint8Array): string {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

const PNG_FIXTURE_BYTES = new Uint8Array([0x50, 0x4e, 0x47, 0x2d]); // "PNG-"
const PNG_FIXTURE_B64 = bytesToBase64(PNG_FIXTURE_BYTES);

// ────────────────────────────────────────────────────────────────────────────
// createCDPScreenshotAdapter
// ────────────────────────────────────────────────────────────────────────────

describe('createCDPScreenshotAdapter', () => {
  test('calls Page.captureScreenshot exactly once with defaults', async () => {
    const send = vi.fn(async () => ({ data: PNG_FIXTURE_B64 }));
    const transport: CDPTransport = { send };
    const adapter = createCDPScreenshotAdapter(transport);

    await adapter.capture();

    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith('Page.captureScreenshot', {
      format: 'png',
      fromSurface: true,
      captureBeyondViewport: false,
    });
  });

  test('user options override defaults and are forwarded to the transport', async () => {
    const send = vi.fn(async () => ({ data: PNG_FIXTURE_B64 }));
    const adapter = createCDPScreenshotAdapter(
      { send },
      {
        format: 'jpeg',
        quality: 75,
        fromSurface: false,
        captureBeyondViewport: true,
      },
    );

    await adapter.capture();

    expect(send).toHaveBeenCalledWith('Page.captureScreenshot', {
      format: 'jpeg',
      quality: 75,
      fromSurface: false,
      captureBeyondViewport: true,
    });
  });

  test('quality is omitted when unset (CDP rejects unknown undefineds in some bindings)', async () => {
    const send = vi.fn(async () => ({ data: PNG_FIXTURE_B64 }));
    const adapter = createCDPScreenshotAdapter({ send });
    await adapter.capture();
    const params = send.mock.calls[0]?.[1] as Record<string, unknown>;
    expect('quality' in params).toBe(false);
  });

  test('decodes the base64 payload to the exact bytes', async () => {
    const send = vi.fn(async () => ({ data: PNG_FIXTURE_B64 }));
    const adapter = createCDPScreenshotAdapter({ send });
    const result = await adapter.capture();
    expect(result).toBeInstanceOf(Uint8Array);
    expect(Array.from(result)).toEqual(Array.from(PNG_FIXTURE_BYTES));
    expect(new TextDecoder().decode(result)).toBe('PNG-');
  });

  test('rejects with a clear error when the transport reply is missing `data`', async () => {
    const send = vi.fn(async () => ({}));
    const adapter = createCDPScreenshotAdapter({ send });
    await expect(adapter.capture()).rejects.toThrow(/Page\.captureScreenshot/);
  });

  test('propagates transport rejection unchanged', async () => {
    const boom = new Error('CDP session closed');
    const send = vi.fn(async () => {
      throw boom;
    });
    const adapter = createCDPScreenshotAdapter({ send });
    await expect(adapter.capture()).rejects.toBe(boom);
  });

  test('dispose is a no-op that resolves', async () => {
    const send = vi.fn(async () => ({ data: PNG_FIXTURE_B64 }));
    const adapter = createCDPScreenshotAdapter({ send });
    // dispose is optional; the CDP adapter ships a resolving stub.
    expect(typeof adapter.dispose).toBe('function');
    await expect(adapter.dispose?.()).resolves.toBeUndefined();
  });
});

// ────────────────────────────────────────────────────────────────────────────
// createTabsScreenshotAdapter
// ────────────────────────────────────────────────────────────────────────────

describe('createTabsScreenshotAdapter', () => {
  const PNG_DATA_URL = `data:image/png;base64,${PNG_FIXTURE_B64}`;

  test('calls captureVisibleTab with undefined windowId and default format', async () => {
    const fn = vi.fn<CaptureVisibleTabFn>(async () => PNG_DATA_URL);
    const adapter = createTabsScreenshotAdapter(fn);

    await adapter.capture();

    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenCalledWith(undefined, { format: 'png' });
  });

  test('forwards windowId and user options to captureVisibleTab', async () => {
    const fn = vi.fn<CaptureVisibleTabFn>(async () => PNG_DATA_URL);
    const adapter = createTabsScreenshotAdapter(fn, {
      windowId: 42,
      format: 'jpeg',
      quality: 80,
    });

    await adapter.capture();

    expect(fn).toHaveBeenCalledWith(42, { format: 'jpeg', quality: 80 });
  });

  test('strips the data:image/png;base64 prefix and decodes to bytes', async () => {
    const fn = vi.fn<CaptureVisibleTabFn>(async () => PNG_DATA_URL);
    const adapter = createTabsScreenshotAdapter(fn);
    const result = await adapter.capture();
    expect(result).toBeInstanceOf(Uint8Array);
    expect(Array.from(result)).toEqual(Array.from(PNG_FIXTURE_BYTES));
  });

  test('accepts a jpeg data URL prefix', async () => {
    const fn = vi.fn<CaptureVisibleTabFn>(async () => `data:image/jpeg;base64,${PNG_FIXTURE_B64}`);
    const adapter = createTabsScreenshotAdapter(fn, { format: 'jpeg' });
    const result = await adapter.capture();
    expect(Array.from(result)).toEqual(Array.from(PNG_FIXTURE_BYTES));
  });

  test('rejects with a clear error when the result lacks a base64 segment', async () => {
    const fn = vi.fn<CaptureVisibleTabFn>(async () => 'data:image/png,not-base64');
    const adapter = createTabsScreenshotAdapter(fn);
    await expect(adapter.capture()).rejects.toThrow(/base64/);
  });

  test('rejects with a clear error when the result is empty', async () => {
    const fn = vi.fn<CaptureVisibleTabFn>(async () => '');
    const adapter = createTabsScreenshotAdapter(fn);
    await expect(adapter.capture()).rejects.toThrow(/captureVisibleTab/);
  });

  test('propagates rejection from the underlying captureVisibleTab', async () => {
    const boom = new Error('No active tab');
    const fn = vi.fn<CaptureVisibleTabFn>(async () => {
      throw boom;
    });
    const adapter = createTabsScreenshotAdapter(fn);
    await expect(adapter.capture()).rejects.toBe(boom);
  });

  test('dispose is a no-op that resolves', async () => {
    const fn = vi.fn<CaptureVisibleTabFn>(async () => PNG_DATA_URL);
    const adapter = createTabsScreenshotAdapter(fn);
    expect(typeof adapter.dispose).toBe('function');
    await expect(adapter.dispose?.()).resolves.toBeUndefined();
  });
});
