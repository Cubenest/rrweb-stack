// `--format json`: machine-readable export. Same schema the MCP tools return
// (P2 PRD §C.3 "same schema as MCP tool returns", §B3) so an AI consumer can
// treat a CLI export and an MCP `get_session_*` response interchangeably. Pure:
// SessionDetail in, JSON string out.

import type { SessionDetail } from '../db.js';

/** The JSON export envelope. Field names mirror the MCP tool return shapes. */
export interface SessionJsonExport {
  readonly id: string;
  readonly origin: string | null;
  readonly url: string | null;
  readonly title: string | null;
  readonly startedAt: string;
  readonly updatedAt: string;
  readonly status: string;
  readonly eventCount: number;
  readonly bytes: number;
  readonly errorCount: number;
  readonly consoleErrors: ReadonlyArray<{
    ts: number;
    level: string;
    message: string;
    stack: string | null;
  }>;
  readonly networkErrors: ReadonlyArray<{
    ts: number;
    method: string;
    url: string;
    status: number | null;
    statusText: string | null;
    resourceType: string | null;
    durationMs: number | null;
    errorText: string | null;
  }>;
}

/** Build the JSON export object (pure; not yet stringified). */
export function toJsonExport(detail: SessionDetail): SessionJsonExport {
  const { session, counts, consoleErrors, networkErrors } = detail;
  return {
    id: session.id,
    origin: session.origin,
    url: session.url,
    title: session.title,
    startedAt: session.createdAt,
    updatedAt: session.updatedAt,
    status: session.status,
    eventCount: session.eventCount,
    bytes: session.bytes,
    errorCount: counts.consoleErrors + counts.networkErrors,
    consoleErrors: consoleErrors.map((c) => ({
      ts: c.ts,
      level: c.level,
      message: c.message,
      stack: c.stack,
    })),
    networkErrors: networkErrors.map((n) => ({
      ts: n.ts,
      method: n.method,
      url: n.url,
      status: n.status,
      statusText: n.statusText,
      resourceType: n.resourceType,
      durationMs: n.durationMs,
      errorText: n.errorText,
    })),
  };
}

/** Render a session as a pretty-printed JSON string (2-space indent). */
export function formatSessionJson(detail: SessionDetail): string {
  return `${JSON.stringify(toJsonExport(detail), null, 2)}\n`;
}
