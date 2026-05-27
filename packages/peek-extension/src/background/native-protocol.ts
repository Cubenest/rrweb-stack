/**
 * Outbound message shapes the SW writes over the native-messaging port to
 * peek-mcp's native-host mode (ADR-0007). These mirror the SQLite schema the
 * host persists to (events_chunks / console_events / network_events in
 * packages/peek-mcp/src/db/migrations/0001_initial.sql).
 *
 * CHUNK BOUNDARY: the native host's ingest handlers are not yet implemented —
 * host.ts currently replies `unhandled_message` for anything but `host.hello`
 * (its own comment defers "session.append, console/network ingest" to "Phase
 * 3d"). This module defines the wire contract so the SW forwards the RIGHT
 * shape now; lighting up the host side is the matching follow-up. Until then
 * the host harmlessly nacks these frames and the SW drops the nack.
 *
 * Framing/transport (4-byte length-prefixed JSON, 1 MB cap) is the port's job;
 * these are just the JSON bodies. Pure types + builders → unit-testable.
 */

import type { RelayConsoleEvent, ShadowReport } from '../messaging/protocol.js';
import type { NetMessage } from '../recorder/messages.js';

/** Identifies the session a batch belongs to (one per recorded tab/page). */
export interface SessionRef {
  sessionId: string;
  /** Top-frame URL/title/origin — the host fills sessions(url,title,origin). */
  url?: string;
  title?: string;
}

/** rrweb event chunk → events_chunks + the gzipped blob (host-side). */
export interface SessionAppendMessage extends SessionRef {
  type: 'session.append';
  /** rrweb `eventWithTime[]` (opaque to the SW; the host walks them). */
  events: unknown[];
}

/** Masked console events → console_events. */
export interface ConsoleAppendMessage extends SessionRef {
  type: 'console.append';
  events: RelayConsoleEvent[];
}

/** Masked network records → network_events. */
export interface NetworkAppendMessage extends SessionRef {
  type: 'network.append';
  records: NetMessage[];
}

/** Closed-shadow-root gap reports (best-effort; host may log or attach). */
export interface ShadowReportMessage extends SessionRef {
  type: 'shadow.report';
  reports: ShadowReport[];
}

export type NativeOutbound =
  | SessionAppendMessage
  | ConsoleAppendMessage
  | NetworkAppendMessage
  | ShadowReportMessage;

/** Build a `session.append` body. Omits empty optional session fields. */
export function sessionAppend(ref: SessionRef, events: unknown[]): SessionAppendMessage {
  return { type: 'session.append', ...compact(ref), events };
}

export function consoleAppend(ref: SessionRef, events: RelayConsoleEvent[]): ConsoleAppendMessage {
  return { type: 'console.append', ...compact(ref), events };
}

export function networkAppend(ref: SessionRef, records: NetMessage[]): NetworkAppendMessage {
  return { type: 'network.append', ...compact(ref), records };
}

export function shadowReport(ref: SessionRef, reports: ShadowReport[]): ShadowReportMessage {
  return { type: 'shadow.report', ...compact(ref), reports };
}

/** Drop undefined optional fields so the wire body is minimal + stable. */
function compact(ref: SessionRef): SessionRef {
  const out: SessionRef = { sessionId: ref.sessionId };
  if (ref.url !== undefined) out.url = ref.url;
  if (ref.title !== undefined) out.title = ref.title;
  return out;
}
