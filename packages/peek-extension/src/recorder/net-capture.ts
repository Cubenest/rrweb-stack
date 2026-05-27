/**
 * Pure helpers for the MAIN-world fetch/XHR monkey-patch (P2 PRD §A.10).
 *
 * The actual `window.fetch = ...` / `XMLHttpRequest.prototype.send = ...`
 * patching is an irreducible side effect that only runs in the page and is
 * exercised by the Phase 3e Playwright E2E. Everything that CAN be pure —
 * normalizing headers to a plain object, stringifying + capping bodies,
 * shaping the `NetMessage` records — lives here so it is unit-tested without
 * a browser.
 *
 * No `chrome.*`, no masking: this code runs in the page's MAIN world which has
 * neither. Redaction happens later in the ISOLATED relay (§H1). The caps here
 * are about not shipping multi-megabyte bodies over `postMessage`, not privacy.
 */

import type { NetMessage } from './messages.js';

/** Cap on captured request/response body length (PRD §A.10 uses 64 KiB). */
export const MAX_BODY_CHARS = 64 * 1024;

/**
 * Normalize the many shapes a fetch `HeadersInit` / XHR header map can take
 * into a plain `Record<string,string>`. Handles `Headers`, `[k,v][]`, and
 * plain objects; ignores anything else. Header names are lower-cased on the
 * `Headers` path (the platform does this) and preserved as-given otherwise —
 * the relay's deny-list matches case-insensitively regardless.
 */
export function headersToObject(
  init: HeadersInit | Record<string, string> | undefined | null,
): Record<string, string> {
  const out: Record<string, string> = {};
  if (!init) return out;

  // `Headers` instance — use its iterator (yields lower-cased names).
  if (typeof Headers !== 'undefined' && init instanceof Headers) {
    init.forEach((value, key) => {
      out[key] = value;
    });
    return out;
  }

  // Array of [name, value] tuples.
  if (Array.isArray(init)) {
    for (const pair of init) {
      if (Array.isArray(pair) && pair.length >= 2) {
        const [k, v] = pair;
        if (typeof k === 'string') out[k] = String(v);
      }
    }
    return out;
  }

  // Plain object.
  if (typeof init === 'object') {
    for (const [k, v] of Object.entries(init)) {
      if (typeof v === 'string') out[k] = v;
      else if (v != null) out[k] = String(v);
    }
  }
  return out;
}

/** Truncate a string to {@link MAX_BODY_CHARS}, appending a marker when cut. */
export function capBody(text: string, max: number = MAX_BODY_CHARS): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max)}… [+${text.length - max} chars]`;
}

/**
 * Best-effort stringify of a request body (`BodyInit`). Only the cheap,
 * synchronous shapes are read; streams/Blobs/FormData are reported by type
 * rather than consumed (consuming them could disturb the in-flight request).
 */
export function bodyToString(body: unknown): string | undefined {
  if (body == null) return undefined;
  if (typeof body === 'string') return capBody(body);
  if (typeof URLSearchParams !== 'undefined' && body instanceof URLSearchParams) {
    return capBody(body.toString());
  }
  if (typeof FormData !== 'undefined' && body instanceof FormData) {
    return '[FormData]';
  }
  if (typeof Blob !== 'undefined' && body instanceof Blob) {
    return `[Blob ${body.size}B]`;
  }
  if (typeof ArrayBuffer !== 'undefined' && body instanceof ArrayBuffer) {
    return `[ArrayBuffer ${body.byteLength}B]`;
  }
  if (typeof ReadableStream !== 'undefined' && body instanceof ReadableStream) {
    return '[ReadableStream]';
  }
  // Unknown shape: stringify defensively, never throw out of the patch.
  try {
    return capBody(String(body));
  } catch {
    return '[unserializable body]';
  }
}

/** Resolve the request URL from a fetch `input` (string | URL | Request). */
export function urlFromFetchInput(input: unknown): string {
  if (typeof input === 'string') return input;
  if (typeof URL !== 'undefined' && input instanceof URL) return input.href;
  if (input && typeof input === 'object' && 'url' in input) {
    return String((input as { url: unknown }).url);
  }
  return '';
}

/** Resolve the HTTP method for a fetch call from input + init, upper-cased. */
export function methodFromFetch(input: unknown, init: RequestInit | undefined): string {
  const fromInit = init?.method;
  if (typeof fromInit === 'string' && fromInit) return fromInit.toUpperCase();
  if (input && typeof input === 'object' && 'method' in input) {
    const m = (input as { method?: unknown }).method;
    if (typeof m === 'string' && m) return m.toUpperCase();
  }
  return 'GET';
}

/** Build the `request` NetMessage for a fetch call (pure). */
export function buildFetchRequest(
  id: string,
  input: unknown,
  init: RequestInit | undefined,
  now: number,
): NetMessage {
  const rec: NetMessage = {
    kind: 'request',
    id,
    ts: now,
    transport: 'fetch',
    url: urlFromFetchInput(input),
    method: methodFromFetch(input, init),
    headers: headersToObject(init?.headers),
  };
  const reqBody = init?.body != null ? bodyToString(init.body) : undefined;
  if (reqBody !== undefined) rec.requestBody = reqBody;
  return rec;
}

/** Build the `response` NetMessage for a fetch response (pure). */
export function buildFetchResponse(
  id: string,
  status: number,
  headers: Record<string, string>,
  bodyText: string,
  now: number,
): NetMessage {
  return {
    kind: 'response',
    id,
    ts: now,
    status,
    headers,
    responseBody: capBody(bodyText),
  };
}

/** Build an `error` NetMessage (pure). */
export function buildNetError(id: string, error: unknown, now: number): NetMessage {
  return {
    kind: 'error',
    id,
    ts: now,
    error: error instanceof Error ? error.message : String(error),
  };
}
