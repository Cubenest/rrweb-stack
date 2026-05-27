// The peek MCP server (Tasks 3.11-3.14). Builds an `McpServer` with the Level-1
// READ-ONLY tool surface (PRD §B3): seven session/query tools plus the
// Playwright repro generator. Writes/action-execution (execute_action,
// request_authorization) are Phase 3d — not registered here.
//
// Design notes:
//   • DB is opened read-only and lazily (openReadonlyDb) so a server can start
//     even before any native host has created ~/.peek/sessions.db; tools then
//     return a clear "no sessions recorded yet" rather than throwing.
//   • Roots scoping is resolved once on `oninitialized` (with the §B5 1s
//     timeout fallback) and applied as a soft origin filter to session lists.
//   • Every tool returns compact JSON text + ids for drill-in, respecting the
//     §B3 token budgets (counts not dumps; truncated fields; capped lists).

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { Database } from 'better-sqlite3';
import { z } from 'zod';
import { openReadonlyDb } from '../db/open.js';
import { loadSessionEvents } from './event-blobs.js';
import { queryDomHistory, reconstructDomAt, userActionsBeforeError } from './event-walker.js';
import { generatePlaywrightRepro } from './playwright-repro.js';
import {
  getConsoleErrors,
  getConsoleEventTs,
  getNetworkErrors,
  getSessionBlobRef,
  getSessionSummaryRow,
  listRecentSessions,
} from './queries.js';
import { type RootsScope, resolveRootsScope } from './roots.js';
import { buildSessionSummary } from './summary.js';

export const SERVER_NAME = 'peek-mcp';
export const SERVER_INSTRUCTIONS =
  'Inspect locally-recorded browser sessions. Start with list_recent_sessions, ' +
  'then drill in by sessionId: get_session_summary for a narrative, ' +
  'get_session_console_errors / get_session_network_errors for failures, ' +
  'get_user_action_before_error to see what the user did before an error, ' +
  'get_dom_snapshot / query_dom_history to inspect the DOM over time, and ' +
  'generate_playwright_repro to turn a session into a Playwright test. All tools ' +
  'are read-only.';

/** A `content: [{ type: 'text' }]` MCP tool result wrapping `value` as pretty JSON. */
function jsonResult(value: unknown): { content: Array<{ type: 'text'; text: string }> } {
  return { content: [{ type: 'text', text: JSON.stringify(value, null, 2) }] };
}

/** A plain-text MCP tool result. */
function textResult(text: string): { content: Array<{ type: 'text'; text: string }> } {
  return { content: [{ type: 'text', text }] };
}

const NO_DB_MESSAGE =
  'No sessions recorded yet. Record a session with the peek browser extension first ' +
  '(the native host creates ~/.peek/sessions.db on first capture).';

/** Truncate a long string for token-budget safety, marking the cut. */
function clip(s: string | null | undefined, max: number): string | null {
  if (s === null || s === undefined) return null;
  return s.length <= max ? s : `${s.slice(0, max)}… [+${s.length - max} chars]`;
}

export interface PeekMcpServer {
  /** The wrapped SDK server (for `connect`). */
  readonly server: McpServer;
  /** Release the DB handle, if open. */
  close(): void;
  /** Resolve + cache the roots scope (called on `oninitialized`; exposed for tests). */
  refreshRootsScope(timeoutMs?: number): Promise<RootsScope>;
  /** The current roots scope (undefined until resolved). */
  readonly rootsScope: RootsScope | undefined;
}

export interface CreatePeekMcpServerOptions {
  /** Override the DB path (tests). Defaults to ~/.peek/sessions.db. */
  readonly dbPath?: string;
  /** Override the rrweb-events base dir (tests). */
  readonly eventsDir?: string;
  /** Roots-list timeout (tests); defaults to 1000ms. */
  readonly rootsTimeoutMs?: number;
}

/**
 * Build the peek MCP server with all Level-1 read tools registered. Call
 * `.server.connect(transport)` to start it. The DB is opened lazily on the
 * first tool call (and reused), so construction never fails on a missing store.
 */
export function createPeekMcpServer(options: CreatePeekMcpServerOptions = {}): PeekMcpServer {
  const server = new McpServer(
    { name: SERVER_NAME, version: '0.1.0-alpha.0' },
    { instructions: SERVER_INSTRUCTIONS },
  );

  let db: Database | undefined;
  let dbResolved = false;
  let rootsScope: RootsScope | undefined;

  /** Open (once) the read-only DB; undefined when no store exists yet. */
  function getDb(): Database | undefined {
    if (!dbResolved) {
      const result = openReadonlyDb(options.dbPath);
      db = result.exists ? result.db : undefined;
      dbResolved = true;
    }
    return db;
  }

  /** Load a session's decoded event stream (empty when no blob / missing). */
  function eventsFor(sessionId: string): ReturnType<typeof loadSessionEvents> {
    const handle = getDb();
    if (!handle) return [];
    const ref = getSessionBlobRef(handle, sessionId);
    if (!ref) return [];
    return loadSessionEvents(ref.blobPath, options.eventsDir);
  }

  const refreshRootsScope: PeekMcpServer['refreshRootsScope'] = async (timeoutMs) => {
    rootsScope = await resolveRootsScope(server.server, {
      timeoutMs: timeoutMs ?? options.rootsTimeoutMs ?? 1000,
    });
    return rootsScope;
  };

  // Resolve roots once the client finishes initializing (PRD §B5). Defensive:
  // resolveRootsScope never throws and times out per claude-code #3315.
  server.server.oninitialized = () => {
    void refreshRootsScope().catch(() => {
      // Already swallowed inside resolveRootsScope; belt-and-suspenders.
    });
  };

  registerTools();

  return {
    server,
    close() {
      db?.close();
    },
    refreshRootsScope,
    get rootsScope() {
      return rootsScope;
    },
  };

  function registerTools(): void {
    // 1. list_recent_sessions ------------------------------------------------
    server.registerTool(
      'list_recent_sessions',
      {
        description:
          "List the user's recently recorded browser sessions, newest first. " +
          'Returns compact rows with ids to pass to the get_session_* tools.',
        inputSchema: {
          limit: z.number().int().min(1).max(50).default(10),
          origin: z.string().optional(),
        },
      },
      ({ limit, origin }) => {
        const handle = getDb();
        if (!handle) return textResult(NO_DB_MESSAGE);
        // Apply the roots soft-scope: if the client scoped to origins and the
        // caller didn't ask for a specific one, restrict to the first scoped
        // origin set by filtering post-query (origins are few).
        const rows = listRecentSessions(handle, {
          limit,
          ...(origin !== undefined ? { origin } : {}),
        });
        const scoped =
          origin === undefined && rootsScope?.allowedOrigins
            ? rows.filter(
                (r) => r.origin !== null && rootsScope?.allowedOrigins?.includes(r.origin),
              )
            : rows;
        return jsonResult(scoped);
      },
    );

    // 2. get_session_summary -------------------------------------------------
    server.registerTool(
      'get_session_summary',
      {
        description:
          'Get an LLM-readable narrative summary of one session: pages visited, ' +
          'click/input counts, navigations, and error counts.',
        inputSchema: { sessionId: z.string() },
      },
      ({ sessionId }) => {
        const handle = getDb();
        if (!handle) return textResult(NO_DB_MESSAGE);
        const row = getSessionSummaryRow(handle, sessionId);
        if (!row) return textResult(`No session found with id '${sessionId}'.`);
        const summary = buildSessionSummary(handle, row, eventsFor(sessionId));
        return jsonResult(summary);
      },
    );

    // 3. get_session_console_errors -----------------------------------------
    server.registerTool(
      'get_session_console_errors',
      {
        description:
          'List console error messages recorded in a session, oldest first. ' +
          'Each row has an id usable with get_user_action_before_error.',
        inputSchema: {
          sessionId: z.string(),
          since: z.number().int().optional(),
          limit: z.number().int().min(1).max(200).default(50),
        },
      },
      ({ sessionId, since, limit }) => {
        const handle = getDb();
        if (!handle) return textResult(NO_DB_MESSAGE);
        const rows = getConsoleErrors(handle, sessionId, {
          limit,
          ...(since !== undefined ? { since } : {}),
        });
        return jsonResult(
          rows.map((r) => ({
            id: r.id,
            ts: r.ts,
            level: r.level,
            message: clip(r.message, 500),
            stack: clip(r.stack, 800),
          })),
        );
      },
    );

    // 4. get_session_network_errors -----------------------------------------
    server.registerTool(
      'get_session_network_errors',
      {
        description:
          'List failed/notable network requests in a session (status >= statusGte ' +
          'or a network error), oldest first.',
        inputSchema: {
          sessionId: z.string(),
          statusGte: z.number().int().min(100).max(599).default(400),
          limit: z.number().int().min(1).max(200).default(50),
        },
      },
      ({ sessionId, statusGte, limit }) => {
        const handle = getDb();
        if (!handle) return textResult(NO_DB_MESSAGE);
        const rows = getNetworkErrors(handle, sessionId, { statusGte, limit });
        return jsonResult(
          rows.map((r) => ({
            id: r.id,
            ts: r.ts,
            method: r.method,
            url: clip(r.url, 300),
            status: r.status,
            statusText: r.statusText,
            resourceType: r.resourceType,
            durationMs: r.durationMs,
            errorText: clip(r.errorText, 300),
          })),
        );
      },
    );

    // 5. get_user_action_before_error ---------------------------------------
    server.registerTool(
      'get_user_action_before_error',
      {
        description:
          'Show the last N user actions (click/type/navigate) before a console ' +
          'error, to reconstruct what the user did. errorId comes from ' +
          'get_session_console_errors.',
        inputSchema: {
          sessionId: z.string(),
          errorId: z.number().int(),
          window: z.number().int().min(1).max(50).default(10),
        },
      },
      ({ sessionId, errorId, window }) => {
        const handle = getDb();
        if (!handle) return textResult(NO_DB_MESSAGE);
        const errorTs = getConsoleEventTs(handle, sessionId, errorId);
        if (errorTs === undefined) {
          return textResult(`No console error with id ${errorId} in session '${sessionId}'.`);
        }
        const actions = userActionsBeforeError(eventsFor(sessionId), errorTs, window);
        return jsonResult({ errorId, errorTs, actions });
      },
    );

    // 6. generate_playwright_repro ------------------------------------------
    server.registerTool(
      'generate_playwright_repro',
      {
        description:
          'Generate a runnable Playwright test from the user actions in a session ' +
          '(optionally limited to a [startTs, endTs] window).',
        inputSchema: {
          sessionId: z.string(),
          startTs: z.number().int().optional(),
          endTs: z.number().int().optional(),
        },
      },
      ({ sessionId, startTs, endTs }) => {
        const handle = getDb();
        if (!handle) return textResult(NO_DB_MESSAGE);
        const row = getSessionSummaryRow(handle, sessionId);
        if (!row) return textResult(`No session found with id '${sessionId}'.`);
        const script = generatePlaywrightRepro(eventsFor(sessionId), {
          title: row.title ?? `peek session ${sessionId}`,
          ...(startTs !== undefined ? { startTs } : {}),
          ...(endTs !== undefined ? { endTs } : {}),
        });
        return textResult(script);
      },
    );

    // 7. get_dom_snapshot ----------------------------------------------------
    server.registerTool(
      'get_dom_snapshot',
      {
        description:
          'Reconstruct the DOM at a timestamp (or a selector subtree within it) ' +
          'and return it as HTML. v1 applies structural/attribute/text mutations ' +
          'on top of the nearest full snapshot.',
        inputSchema: {
          sessionId: z.string(),
          ts: z.number().int(),
          selector: z.string().optional(),
        },
      },
      ({ sessionId, ts, selector }) => {
        const handle = getDb();
        if (!handle) return textResult(NO_DB_MESSAGE);
        const snap = reconstructDomAt(eventsFor(sessionId), ts, selector);
        if (!snap) {
          return textResult(
            `No DOM snapshot available at ts ${ts} for session '${sessionId}' (no full snapshot at or before that time).`,
          );
        }
        // Cap the HTML to keep within the ~10K-token budget.
        return jsonResult({
          baseSnapshotTs: snap.baseSnapshotTs,
          mutationsApplied: snap.mutationsApplied,
          html: clip(snap.html, 24000),
        });
      },
    );

    // 8. query_dom_history ---------------------------------------------------
    server.registerTool(
      'query_dom_history',
      {
        description:
          "Timeline of attribute and/or text changes for a selector's node over " +
          'a session. op restricts to attributeChanges or innerText.',
        inputSchema: {
          sessionId: z.string(),
          selector: z.string(),
          op: z.enum(['attributeChanges', 'innerText']).optional(),
          limit: z.number().int().min(1).max(500).default(100),
        },
      },
      ({ sessionId, selector, op, limit }) => {
        const handle = getDb();
        if (!handle) return textResult(NO_DB_MESSAGE);
        const changes = queryDomHistory(eventsFor(sessionId), selector, {
          limit,
          ...(op !== undefined ? { op } : {}),
        });
        return jsonResult({ selector, changes });
      },
    );
  }
}

/** The tool names this server registers, for smoke tests / docs. */
export const PEEK_MCP_TOOLS = [
  'list_recent_sessions',
  'get_session_summary',
  'get_session_console_errors',
  'get_session_network_errors',
  'get_user_action_before_error',
  'generate_playwright_repro',
  'get_dom_snapshot',
  'query_dom_history',
] as const;
