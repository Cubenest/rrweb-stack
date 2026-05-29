/**
 * Wire shapes for the MAIN-world recorder → ISOLATED-world relay channel
 * (P2 PRD §A.2), and the validators the relay uses to decide whether an
 * incoming `window.postMessage` is a genuine peek event.
 *
 * The MAIN-world recorder runs in the page's realm where ANY script can call
 * `window.postMessage`. The ISOLATED relay therefore treats every inbound
 * message as untrusted and validates the shape before doing anything with it
 * (threat model §H1: "Site-injected JS extracts recorded data"). These
 * predicates are pure and unit-tested — the privacy boundary's first gate.
 *
 * One message family travels this channel as of alpha.6 (Phase 5 / Task #72):
 *   - `'peek'` — rrweb DOM/console/network/plugin events
 *               (`{ source, payload: eventWithTime }`).
 *
 * Network records used to ride a parallel `'peek-net'` source from a
 * MAIN-world fetch/XHR monkey-patch. Phase 3 of the rrweb-network-plugin
 * migration (commit 12b80b3) deleted that path — the network plugin now
 * emits `EventType.Plugin` events through the rrweb event stream itself, so
 * everything arrives via the single `'peek'` source. The `NetMessage` shape
 * below is retained because DeepCaptureManager and the SW's network-plugin
 * synthesizer still write `NetMessage` envelopes on the `network.append`
 * channel; both populate them server-side without needing a wire-source tag.
 */

/** `source` tag for rrweb DOM/console/network events posted from MAIN world. */
export const PEEK_RRWEB_SOURCE = 'peek';

/**
 * A single network record persisted on the `network.append` native-host
 * channel. Two producers fill this shape: (a) DeepCaptureManager (CDP
 * `Network.responseReceived` → `maskNetMessage`); (b) the SW's
 * `network-plugin-synth.ts` (synthesizes from `EventType.Plugin` /
 * `rrweb/network@1` events the recorder emits). `id` correlates a request
 * with its response/error. Bodies + headers are already redacted by the
 * time they reach this shape (the privacy boundary is upstream).
 */
export interface NetMessage {
  kind: 'request' | 'response' | 'error';
  /** Correlation id (crypto.randomUUID or a synth-derived deterministic id). */
  id: string;
  /** epoch-millis the record was produced. */
  ts: number;
  /** Request transport (`fetch` | `xhr`). Present on `request` records. */
  transport?: 'fetch' | 'xhr';
  url?: string;
  method?: string;
  /** Redacted request/response headers as a plain object. */
  headers?: Record<string, string>;
  /** Redacted request body, stringified + capped. */
  requestBody?: string;
  /** HTTP status on a `response` record. */
  status?: number;
  /** Redacted response body preview, capped. */
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

/**
 * The union of validated peek messages. Today only one family rides this
 * channel; the union is preserved as a forward-compat shape so future
 * MAIN→ISOLATED message types (e.g. action-result acks) slot in without
 * changing every call site.
 */
export type PeekMessage = PeekRrwebMessage;

/**
 * Is `data` an object with a `source` field equal to our tag? Cheap first
 * filter the relay runs on every `message` event before deeper checks.
 */
export function isPeekMessage(data: unknown): data is PeekMessage {
  if (typeof data !== 'object' || data === null) return false;
  return (data as { source?: unknown }).source === PEEK_RRWEB_SOURCE;
}

/** Narrow a validated peek message to the rrweb family. */
export function isRrwebMessage(msg: PeekMessage): msg is PeekRrwebMessage {
  return msg.source === PEEK_RRWEB_SOURCE && 'payload' in msg && msg.payload != null;
}
