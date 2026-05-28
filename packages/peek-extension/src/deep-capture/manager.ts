/**
 * Deep-capture per-tab attach/detach lifecycle (Task 3.26, ADR-0010).
 *
 * When the user opts in for an origin, this manager:
 *   1. Calls `chrome.debugger.attach({ tabId }, '1.3')` (Chrome DevTools
 *      Protocol version 1.3 is the stable supported one).
 *   2. Sends `Network.enable` so the browser starts emitting
 *      `Network.responseReceived` events for that tab.
 *   3. On each response, fetches the body via `Network.getResponseBody` and
 *      hands the (masked) body to the recorder's `network.append` channel.
 *   4. On `toggle off` or `chrome.tabs.onRemoved`, sends
 *      `chrome.debugger.detach({ tabId })` to release the page.
 *
 * Side note (privacy): the response BODY is the new data Deep capture exposes
 * compared to the SW's normal fetch-wrap. The body is run through
 * {@link sanitizeBody} (the same `redactBody` PII regex bank used for
 * outbound network records in mask.ts) before it leaves this module.
 *
 * Everything that touches `chrome.debugger` is behind a `DebuggerSurface`
 * interface so this module unit-tests against an in-memory fake. The SW wires
 * the real `chrome.debugger` in production (see deep-capture/wire.ts in a
 * future chunk; for Phase 3d this module is the seam + the toggle is what
 * users see — actual end-to-end with the live CDP is Phase 3e E2E).
 */

import { originFromUrl } from '../activation/origin.js';
import type { NetMessage } from '../recorder/messages.js';
import { maskNetMessage } from '../relay/mask.js';

/** A target for `chrome.debugger.attach` — we only ever attach per-tab. */
export interface DebuggeeTab {
  readonly tabId: number;
}

/** The subset of `chrome.debugger.*` we actually call (testable shim). */
export interface DebuggerSurface {
  attach(target: DebuggeeTab, protocolVersion: string): Promise<void>;
  detach(target: DebuggeeTab): Promise<void>;
  sendCommand<T = unknown>(
    target: DebuggeeTab,
    method: string,
    params?: Record<string, unknown>,
  ): Promise<T>;
  onEvent(listener: (source: DebuggeeTab, method: string, params: unknown) => void): () => void; // returns an unsubscribe handle
}

/** CDP version we attach with (1.3 is the stable supported one). */
export const CDP_PROTOCOL_VERSION = '1.3';

/**
 * Hard cap on the persisted Deep-capture body length (bytes of UTF-16 code
 * units — JS string `.length`). 256 KB is a pragmatic ceiling: large enough
 * to keep the common JSON-API responses intact for replay; small enough that
 * a long-running session with multi-MB downloads (CSV exports, media manifest
 * blobs) doesn't balloon `~/.peek/sessions.db` immediately. Bodies above this
 * limit are truncated post-mask (so the truncation can't cut through a
 * redaction marker mid-string) and tagged with {@link BODY_TRUNCATION_MARKER}.
 */
export const MAX_BODY_BYTES = 256 * 1024;

/** Marker appended to a body that was truncated at {@link MAX_BODY_BYTES}. */
export const BODY_TRUNCATION_MARKER = '<<BODY_TRUNCATED@256KB>>';

/** Hook the manager calls when it has a (masked) body to forward. */
export type ForwardBody = (tabId: number, record: NetMessage) => void;

export interface DeepCaptureManagerDeps {
  readonly debugger: DebuggerSurface;
  /** Called for every captured response body — the SW wires to the recorder. */
  readonly onBody: ForwardBody;
}

interface AttachedTab {
  tabId: number;
  unsubscribeEvent: () => void;
}

/**
 * Manage per-tab debugger attach state. Idempotent: attaching an
 * already-attached tab is a no-op; detaching a never-attached tab is a no-op.
 */
export class DeepCaptureManager {
  readonly #deps: DeepCaptureManagerDeps;
  readonly #attached = new Map<number, AttachedTab>();

  constructor(deps: DeepCaptureManagerDeps) {
    this.#deps = deps;
  }

  /** Tabs the manager has live attachments for. */
  get attachedTabs(): readonly number[] {
    return [...this.#attached.keys()];
  }

  async attach(tabId: number): Promise<void> {
    if (this.#attached.has(tabId)) return;
    await this.#deps.debugger.attach({ tabId }, CDP_PROTOCOL_VERSION);
    await this.#deps.debugger.sendCommand({ tabId }, 'Network.enable');

    const unsubscribe = this.#deps.debugger.onEvent((source, method, params) => {
      if (source.tabId !== tabId) return;
      if (method !== 'Network.responseReceived') return;
      // Best-effort, fire-and-forget. A failed body fetch must not tear down
      // the attach; log + continue.
      this.#captureBody(tabId, params).catch((err) => {
        console.debug('[peek] Deep capture body fetch failed:', err);
      });
    });

    this.#attached.set(tabId, { tabId, unsubscribeEvent: unsubscribe });
  }

  async detach(tabId: number): Promise<void> {
    const entry = this.#attached.get(tabId);
    if (!entry) return;
    entry.unsubscribeEvent();
    this.#attached.delete(tabId);
    try {
      await this.#deps.debugger.detach({ tabId });
    } catch (err) {
      // The tab may have already closed — debugger.detach throws on a
      // closed-target. Best-effort; don't crash.
      console.debug('[peek] Deep capture detach failed:', err);
    }
  }

  /** Detach every attached tab — used on toggle-off / shutdown. */
  async detachAll(): Promise<void> {
    const ids = [...this.#attached.keys()];
    await Promise.all(ids.map((id) => this.detach(id)));
  }

  /**
   * Detach every attached tab whose URL has the given origin. Used by the SW
   * when the user disables Deep capture for an origin — the toggle MUST revoke
   * immediately for ALL tabs of that origin, not just the active one. Otherwise
   * background tabs continue capturing response bodies until the user activates
   * them (a privacy regression).
   *
   * @param origin the bare origin (`https://example.com`) just removed from the
   *   persisted opt-in list.
   * @param resolveUrl async resolver from tabId → current URL (the SW wires
   *   `chrome.tabs.get`). Returns `undefined` if the tab is gone / inaccessible
   *   — those tabs are skipped (detach-on-close handles them separately).
   * @returns the tabIds that were detached.
   */
  async detachOrigin(
    origin: string,
    resolveUrl: (tabId: number) => Promise<string | undefined>,
  ): Promise<readonly number[]> {
    const candidates = [...this.#attached.keys()];
    const urls = await Promise.all(candidates.map((id) => resolveUrl(id).catch(() => undefined)));
    const toDetach: number[] = [];
    for (let i = 0; i < candidates.length; i++) {
      const url = urls[i];
      if (!url) continue;
      if (originFromUrl(url) !== origin) continue;
      // biome-ignore lint/style/noNonNullAssertion: paired with urls[i] above
      toDetach.push(candidates[i]!);
    }
    await Promise.all(toDetach.map((id) => this.detach(id)));
    return toDetach;
  }

  // ---- internals -----------------------------------------------------------

  async #captureBody(tabId: number, params: unknown): Promise<void> {
    const info = parseResponseReceived(params);
    if (!info) return;
    let body: { body: string; base64Encoded?: boolean } | undefined;
    try {
      body = await this.#deps.debugger.sendCommand<{
        body: string;
        base64Encoded?: boolean;
      }>({ tabId }, 'Network.getResponseBody', { requestId: info.requestId });
    } catch (err) {
      // The body may not be available yet (response not finished) or the
      // resource may be a redirect with no body. Skip silently.
      console.debug('[peek] Network.getResponseBody:', err);
      return;
    }

    // The raw body has NOT yet been redacted. Build a NetMessage so we can
    // route it through the same `maskNetMessage` PII pipeline the SW uses.
    const raw: NetMessage = {
      kind: 'response',
      id: info.requestId,
      ts: Date.now(),
      url: info.url,
      method: info.method,
      status: info.status,
      responseBody: body?.base64Encoded ? '<<BASE64_BODY_DROPPED>>' : body?.body,
    };
    const masked = maskNetMessage(raw);
    // Cap the body length AFTER masking — truncating pre-mask risks cutting
    // through a redaction marker (so a half-redacted token could slip out).
    if (typeof masked.responseBody === 'string') {
      masked.responseBody = capBody(masked.responseBody);
    }
    this.#deps.onBody(tabId, masked);
  }
}

/**
 * Truncate `body` to {@link MAX_BODY_BYTES} when it exceeds the cap, appending
 * {@link BODY_TRUNCATION_MARKER} so the reader can tell the body was cut.
 * Bodies at or below the cap are returned unchanged. Exported for tests.
 */
export function capBody(body: string): string {
  if (body.length <= MAX_BODY_BYTES) return body;
  return body.slice(0, MAX_BODY_BYTES) + BODY_TRUNCATION_MARKER;
}

interface ParsedResponseReceived {
  readonly requestId: string;
  readonly url: string;
  readonly method: string;
  readonly status: number;
}

/**
 * Extract the fields we need from a `Network.responseReceived` event. Pure +
 * defensive (the params come from the browser but are still untyped).
 */
function parseResponseReceived(params: unknown): ParsedResponseReceived | null {
  if (typeof params !== 'object' || params === null) return null;
  const p = params as {
    requestId?: unknown;
    response?: { url?: unknown; status?: unknown; requestHeaders?: unknown };
    type?: unknown;
  };
  const requestId = typeof p.requestId === 'string' ? p.requestId : null;
  const url = p.response && typeof p.response.url === 'string' ? p.response.url : null;
  const status = p.response && typeof p.response.status === 'number' ? p.response.status : null;
  if (!requestId || !url || status === null) return null;
  return { requestId, url, method: 'GET', status };
}
