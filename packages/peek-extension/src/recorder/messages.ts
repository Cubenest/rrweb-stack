/**
 * Wire shapes for the MAIN-world recorder → ISOLATED-world relay channel
 * (P2 PRD §A.2 + §A.10), and the validators the relay uses to decide whether
 * an incoming `window.postMessage` is a genuine peek event.
 *
 * The MAIN-world recorder runs in the page's realm where ANY script can call
 * `window.postMessage`. The ISOLATED relay therefore treats every inbound
 * message as untrusted and validates the shape before doing anything with it
 * (threat model §H1: "Site-injected JS extracts recorded data"). These
 * predicates are pure and unit-tested — the privacy boundary's first gate.
 *
 * Two message families share the channel, distinguished by `source`:
 *   - `'peek'`     — rrweb DOM/console events (`{ source, payload: eventWithTime }`).
 *   - `'peek-net'` — fetch/XHR network records (`{ source, payload: NetMessage }`).
 *
 * The string tags intentionally diverge from the PRD's draft `'p2'`/`'p2-net'`
 * (the product is `peek`, not the working codename `p2`); the task brief locks
 * `'peek'`/`'peek-net'`.
 */

/** `source` tag for rrweb DOM/console events posted from MAIN world. */
export const PEEK_RRWEB_SOURCE = 'peek';
/** `source` tag for fetch/XHR network records posted from MAIN world. */
export const PEEK_NET_SOURCE = 'peek-net';

/** A network record kind emitted by the fetch/XHR monkey-patch (§A.10). */
export type NetMessageKind = 'request' | 'response' | 'error';

/**
 * A single network record from the MAIN-world fetch/XHR wrap. Headers/body are
 * captured RAW here (MAIN world has no `chrome.*` and no masking primitives);
 * redaction happens in the ISOLATED relay before the record leaves the content
 * script (§H1, ADR-0002). `id` correlates a request with its response/error.
 */
export interface NetMessage {
  kind: NetMessageKind;
  /** Correlation id (crypto.randomUUID) shared by a request and its response. */
  id: string;
  /** epoch-millis the record was produced. */
  ts: number;
  /** Request transport (`fetch` | `xhr`). Present on `request` records. */
  transport?: 'fetch' | 'xhr';
  url?: string;
  method?: string;
  /** Raw request/response headers as a plain object (pre-redaction). */
  headers?: Record<string, string>;
  /** Raw request body, stringified + capped in MAIN world (pre-redaction). */
  requestBody?: string;
  /** HTTP status on a `response` record. */
  status?: number;
  /** Raw response body preview, capped in MAIN world (pre-redaction). */
  responseBody?: string;
  /** Error string on an `error` record. */
  error?: string;
}

/** The envelope an rrweb event is posted in. `payload` is an `eventWithTime`. */
export interface PeekRrwebMessage {
  source: typeof PEEK_RRWEB_SOURCE;
  /** rrweb `eventWithTime` — kept `unknown` here; the relay forwards it opaque. */
  payload: unknown;
}

/** The envelope a network record is posted in. */
export interface PeekNetMessage {
  source: typeof PEEK_NET_SOURCE;
  payload: NetMessage;
}

export type PeekMessage = PeekRrwebMessage | PeekNetMessage;

/**
 * Is `data` an object with a `source` field equal to one of our tags? Cheap
 * first filter the relay runs on every `message` event before deeper checks.
 */
export function isPeekMessage(data: unknown): data is PeekMessage {
  if (typeof data !== 'object' || data === null) return false;
  const source = (data as { source?: unknown }).source;
  return source === PEEK_RRWEB_SOURCE || source === PEEK_NET_SOURCE;
}

/** Narrow a validated peek message to the rrweb family. */
export function isRrwebMessage(msg: PeekMessage): msg is PeekRrwebMessage {
  return msg.source === PEEK_RRWEB_SOURCE && 'payload' in msg && msg.payload != null;
}

/**
 * Narrow + validate a peek message as a well-formed network record. Guards the
 * fields the relay actually reads (kind, id) so a malformed/hostile post can't
 * slip a partially-shaped record into the redaction path.
 */
export function isNetMessage(msg: PeekMessage): msg is PeekNetMessage {
  if (msg.source !== PEEK_NET_SOURCE) return false;
  const payload = (msg as PeekNetMessage).payload as unknown;
  if (typeof payload !== 'object' || payload === null) return false;
  const { kind, id } = payload as { kind?: unknown; id?: unknown };
  if (kind !== 'request' && kind !== 'response' && kind !== 'error') return false;
  if (typeof id !== 'string' || id.length === 0) return false;
  return true;
}
