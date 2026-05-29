// `--format json`: machine-readable export. Same schema the MCP tools return
// (P2 PRD §C.3 "same schema as MCP tool returns", §B3) so an AI consumer can
// treat a CLI export and an MCP `get_session_*` response interchangeably. Pure:
// SessionDetail in, JSON string out.
//
// Phase 5 self-marketing: every export carries a top-level `_attribution` block
// (underscore-prefixed per JSON convention for "metadata not data") so a JSON
// export shared in a PR or attached to a JIRA ticket is a tracked acquisition
// channel — the Loom / Calendly / Statuspage indirect-virality pattern. The
// block contains only static strings + the CLI version; no session content
// leaks in.

import { CLI_VERSION } from '../../version.js';
import type { SessionDetail } from '../db.js';

/** Static attribution block shape — never references session data. */
export interface AttributionBlock {
  readonly tool: 'peek';
  readonly url: string;
  readonly description: string;
  readonly version: string;
}

/**
 * Build the self-marketing attribution block (Phase 5 indirect virality).
 *
 * The URL links to `packages/peek-mcp` because the install command
 * (`npm i @peekdev/mcp` / `peek init`) is the marketing artifact per the
 * research — not the docs site, not a landing page. The UTM medium is
 * format-specific so we can attribute which export shape drives the most
 * click-through (JSON vs Markdown vs future formats).
 */
export function buildAttribution(
  medium: 'json-attribution' | 'markdown-attribution',
): AttributionBlock {
  return {
    tool: 'peek',
    url: `https://github.com/Cubenest/rrweb-stack/tree/main/packages/peek-mcp?utm_source=peek-export&utm_medium=${medium}&utm_campaign=indirect-virality`,
    description:
      'Captured with peek — your real browser, exposed to your AI coding agent over MCP. Capture once, query forever, never leaves your machine.',
    version: CLI_VERSION,
  };
}

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

/**
 * Render a session as a pretty-printed JSON string (2-space indent).
 *
 * `_attribution` is inserted FIRST in the object literal so it appears at the
 * top of the serialized output — `JSON.stringify` preserves insertion order
 * per the ECMA-262 spec for string keys (own enumerable string properties are
 * visited in insertion order). The `_` prefix is the JSON convention for
 * "metadata, not data" — discoverable but not part of the session payload.
 */
export function formatSessionJson(detail: SessionDetail): string {
  const envelope = {
    _attribution: buildAttribution('json-attribution'),
    session: toJsonExport(detail),
  };
  return `${JSON.stringify(envelope, null, 2)}\n`;
}
