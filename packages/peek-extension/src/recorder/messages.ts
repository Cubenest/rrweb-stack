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
 * A handshake message between the MAIN-world recorder and the ISOLATED relay.
 * Both scripts run at document_start but in different execution contexts, so
 * their attach order is not guaranteed: if the recorder's first emit (Meta +
 * FullSnapshot) fires before the relay's `addEventListener('message')`
 * registers, those events are lost forever and the session becomes
 * unreconstructable by `get_dom_snapshot`. The handshake closes that race:
 *
 *   - On attach, the relay broadcasts `kind: 'relay-ready'`.
 *   - The recorder probes with `kind: 'recorder-probe'` until it sees a
 *     `relay-ready` back (covers the case where the relay attaches AFTER the
 *     recorder loaded and the initial broadcast was missed).
 *   - The relay responds to every probe with another `relay-ready`.
 *   - The recorder buffers rrweb events until it sees `relay-ready`, then
 *     drains the buffer in order.
 *
 * Carries no rrweb payload — recipients distinguish from rrweb events by the
 * presence of the `kind` field (handshakes) vs. `payload` (rrweb events).
 */
export interface PeekHandshakeMessage {
  source: typeof PEEK_RRWEB_SOURCE;
  kind: 'recorder-probe' | 'relay-ready';
}

/**
 * The union of validated peek messages. Two families ride this channel:
 *   - {@link PeekRrwebMessage}     — the rrweb event stream
 *   - {@link PeekHandshakeMessage} — the recorder/relay attach handshake
 *
 * Both share the `source: 'peek'` tag; recipients narrow on the discriminator.
 */
export type PeekMessage = PeekRrwebMessage | PeekHandshakeMessage;

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
  return 'payload' in msg && (msg as PeekRrwebMessage).payload != null;
}

/** Narrow a validated peek message to the handshake family. */
export function isHandshakeMessage(msg: PeekMessage): msg is PeekHandshakeMessage {
  if (!('kind' in msg)) return false;
  const kind = (msg as PeekHandshakeMessage).kind;
  return kind === 'recorder-probe' || kind === 'relay-ready';
}
