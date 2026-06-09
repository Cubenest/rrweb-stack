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

import { createRequire } from 'node:module';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { Database } from 'better-sqlite3';
import { z } from 'zod';
import { openReadonlyDb } from '../db/open.js';

// Read version at runtime from this package's package.json so the MCP
// `serverInfo.version` reply always matches what npm shipped. The relative
// path is from the compiled dist/mcp/server.js → ../../package.json.
const _require = createRequire(import.meta.url);
const _pkg = _require('../../package.json') as { version: string };
export const SERVER_VERSION = _pkg.version;
import {
  type AuditResult,
  type AuditTool,
  type AuditWriteOptions,
  recordAuditEntry,
} from '../native-host/audit.js';
import { ActionSchema } from './action-schema.js';
import { SessionEventsError, loadSessionEvents } from './event-blobs.js';
import { queryDomHistory, reconstructDomAt, userActionsBeforeError } from './event-walker.js';
import { type HostBridge, MissingHostBridge } from './host-bridge.js';
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
  'Inspect locally-recorded browser sessions and (Level 3+) execute actions ' +
  "in the user's browser. Start with list_recent_sessions, then drill in by " +
  'sessionId: get_session_summary for a narrative, get_session_console_errors / ' +
  'get_session_network_errors for failures, get_user_action_before_error to ' +
  'see what the user did before an error, get_dom_snapshot / query_dom_history ' +
  'to inspect the DOM over time, and generate_playwright_repro to turn a ' +
  'session into a Playwright test. The write tools — execute_action and ' +
  'request_authorization — are gated by a five-level per-origin permission ' +
  'model with a destructive-action override; consult the user via ' +
  'request_authorization before high-impact actions.';

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
  /**
   * The host bridge for act-tool dispatch (Task 3.24). Defaults to a
   * {@link MissingHostBridge} that returns a structured "bridge not wired"
   * denied — so the MCP server constructs cleanly in a process that has no
   * native-host IPC + every act-tool call still goes through the audit log.
   * Tests inject a {@link RegistryBackedHostBridge}; the production IPC
   * implementation is the 3d-4/3e integration layer.
   */
  readonly hostBridge?: HostBridge;
  /**
   * Override the audit-log path (tests). Defaults to ~/.peek/audit.log via
   * the audit module. The MCP server (this process) writes the audit log
   * directly — it's the trust surface, so the closest process to the AI
   * client gets the write. The user-policy reader lives on the native-host
   * side (where the SW round-trip happens).
   */
  readonly auditLogPath?: string;
}

/**
 * Build the peek MCP server with all Level-1 read tools registered. Call
 * `.server.connect(transport)` to start it. The DB is opened lazily on the
 * first tool call (and reused), so construction never fails on a missing store.
 */
export function createPeekMcpServer(options: CreatePeekMcpServerOptions = {}): PeekMcpServer {
  const server = new McpServer(
    { name: SERVER_NAME, version: SERVER_VERSION },
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

  /**
   * Load a session's decoded event stream. Returns `{ ok:true, events }` (empty
   * when no blob / missing), or `{ ok:false, message }` when the blob exists but
   * is corrupt — the event-using tools surface that as a clean error result
   * rather than letting the throw bubble out as an opaque internal error.
   */
  function eventsFor(
    sessionId: string,
  ): { ok: true; events: ReturnType<typeof loadSessionEvents> } | { ok: false; message: string } {
    const handle = getDb();
    if (!handle) return { ok: true, events: [] };
    const ref = getSessionBlobRef(handle, sessionId);
    if (!ref) return { ok: true, events: [] };
    try {
      return { ok: true, events: loadSessionEvents(ref.blobPath, options.eventsDir) };
    } catch (err) {
      if (err instanceof SessionEventsError) return { ok: false, message: err.message };
      throw err;
    }
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
        title: 'List recent browser sessions',
        description:
          "List the user's recorded browser sessions, newest first — the entry point for the get_session_* and DOM tools. Returns compact JSON rows ({ sessionId, origin, url, title, startedAt, ... }); free-text fields are clipped (origin 100, url 300, title 200 chars). If the MCP client scoped roots to specific origins and no origin filter is given, results are restricted to the first scoped origin. Start here to obtain a sessionId, then call get_session_summary.",
        inputSchema: {
          limit: z
            .number()
            .int()
            .min(1)
            .max(50)
            .default(10)
            .describe('Maximum sessions to return (1-50, newest first; default 10).'),
          origin: z
            .string()
            .optional()
            .describe(
              "Filter to one origin, e.g. 'https://app.example.com'. Omit to list across all recorded origins (subject to client roots scoping).",
            ),
        },
        annotations: { readOnlyHint: true, openWorldHint: false },
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
        // Clip free-text fields for budget consistency with the other tools.
        return jsonResult(
          scoped.map((r) => ({
            ...r,
            origin: clip(r.origin, 100),
            url: clip(r.url, 300),
            title: clip(r.title, 200),
          })),
        );
      },
    );

    // 2. get_session_summary -------------------------------------------------
    server.registerTool(
      'get_session_summary',
      {
        title: 'Summarize a session',
        description:
          'Get an LLM-readable narrative summary of one session: pages visited, click/input/navigation counts, and error counts. Use this first for an overview before drilling into get_session_console_errors / get_session_network_errors. Returns a structured JSON summary.',
        inputSchema: {
          sessionId: z.string().describe('Session id from list_recent_sessions.'),
        },
        annotations: { readOnlyHint: true, openWorldHint: false },
      },
      ({ sessionId }) => {
        const handle = getDb();
        if (!handle) return textResult(NO_DB_MESSAGE);
        const row = getSessionSummaryRow(handle, sessionId);
        if (!row) return textResult(`No session found with id '${sessionId}'.`);
        const ev = eventsFor(sessionId);
        if (!ev.ok) return textResult(ev.message);
        const summary = buildSessionSummary(handle, row, ev.events);
        return jsonResult(summary);
      },
    );

    // 3. get_session_console_errors -----------------------------------------
    server.registerTool(
      'get_session_console_errors',
      {
        title: 'List console errors',
        description:
          'List console error messages recorded in a session, oldest first. Each row has a numeric id to pass to get_user_action_before_error. Returns JSON rows ({ id, ts, level, message, stack }); message clipped to 500 and stack to 800 chars. For error counts at a glance, use get_session_summary first.',
        inputSchema: {
          sessionId: z.string().describe('Session id from list_recent_sessions.'),
          since: z
            .number()
            .int()
            .optional()
            .describe(
              'Only return errors with ts >= this epoch-ms timestamp (to page forward through a long session). Omit to start from the beginning.',
            ),
          limit: z
            .number()
            .int()
            .min(1)
            .max(200)
            .default(50)
            .describe('Maximum errors to return (1-200, oldest first; default 50).'),
        },
        annotations: { readOnlyHint: true, openWorldHint: false },
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
        title: 'List failed network requests',
        description:
          'List failed or notable network requests in a session (HTTP status >= statusGte, or a transport-level network error), oldest first. Returns JSON rows ({ id, ts, method, url, status, statusText, resourceType, durationMs, errorText }); url and errorText clipped to 300 chars.',
        inputSchema: {
          sessionId: z.string().describe('Session id from list_recent_sessions.'),
          statusGte: z
            .number()
            .int()
            .min(100)
            .max(599)
            .default(400)
            .describe(
              'Minimum HTTP status treated as notable (100-599; default 400, i.e. 4xx/5xx). Transport-level errors are always included regardless.',
            ),
          limit: z
            .number()
            .int()
            .min(1)
            .max(200)
            .default(50)
            .describe('Maximum requests to return (1-200, oldest first; default 50).'),
        },
        annotations: { readOnlyHint: true, openWorldHint: false },
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
        title: 'Actions before an error',
        description:
          'Reconstruct what the user did right before a console error: returns the last `window` user actions (click/type/navigate) preceding the error, to explain how it was triggered. Returns JSON { errorId, errorTs, actions }. Get errorId from get_session_console_errors first.',
        inputSchema: {
          sessionId: z.string().describe('Session id from list_recent_sessions.'),
          errorId: z.number().int().describe('Console error id from get_session_console_errors.'),
          window: z
            .number()
            .int()
            .min(1)
            .max(50)
            .default(10)
            .describe('How many preceding user actions to return (1-50; default 10).'),
        },
        annotations: { readOnlyHint: true, openWorldHint: false },
      },
      ({ sessionId, errorId, window }) => {
        const handle = getDb();
        if (!handle) return textResult(NO_DB_MESSAGE);
        const errorTs = getConsoleEventTs(handle, sessionId, errorId);
        if (errorTs === undefined) {
          return textResult(`No console error with id ${errorId} in session '${sessionId}'.`);
        }
        const ev = eventsFor(sessionId);
        if (!ev.ok) return textResult(ev.message);
        const actions = userActionsBeforeError(ev.events, errorTs, window);
        return jsonResult({ errorId, errorTs, actions });
      },
    );

    // 6. generate_playwright_repro ------------------------------------------
    server.registerTool(
      'generate_playwright_repro',
      {
        title: 'Generate Playwright repro',
        description:
          'Generate a runnable Playwright test (TypeScript) reproducing the user actions in a session: clicks, typing, navigation, and <select> changes. Optionally limit to a [startTs, endTs] epoch-ms window. Returns the test source as text. Note: only single-value <select> is represented (rrweb captures one value per input).',
        inputSchema: {
          sessionId: z.string().describe('Session id from list_recent_sessions.'),
          startTs: z
            .number()
            .int()
            .optional()
            .describe(
              'Only include actions at or after this epoch-ms timestamp. Omit to start at the session beginning.',
            ),
          endTs: z
            .number()
            .int()
            .optional()
            .describe(
              'Only include actions at or before this epoch-ms timestamp. Omit to run through the session end.',
            ),
        },
        annotations: { readOnlyHint: true, openWorldHint: false },
      },
      ({ sessionId, startTs, endTs }) => {
        const handle = getDb();
        if (!handle) return textResult(NO_DB_MESSAGE);
        const row = getSessionSummaryRow(handle, sessionId);
        if (!row) return textResult(`No session found with id '${sessionId}'.`);
        const ev = eventsFor(sessionId);
        if (!ev.ok) return textResult(ev.message);
        const script = generatePlaywrightRepro(ev.events, {
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
        title: 'Reconstruct DOM at a time',
        description:
          'Reconstruct the page DOM as it existed at a timestamp (or a selector subtree within it) and return it as HTML. Applies structural/attribute/text mutations on top of the nearest full snapshot at or before ts. Returns JSON { baseSnapshotTs, mutationsApplied, html }; html clipped to 24000 chars. Fails if no full snapshot exists at or before ts.',
        inputSchema: {
          sessionId: z.string().describe('Session id from list_recent_sessions.'),
          ts: z
            .number()
            .int()
            .describe(
              'Epoch-ms timestamp to reconstruct the DOM at. Use timestamps from get_session_summary, error rows, or get_user_action_before_error.',
            ),
          selector: z
            .string()
            .optional()
            .describe(
              'CSS selector to return only that subtree. Omit to return the full document.',
            ),
        },
        annotations: { readOnlyHint: true, openWorldHint: false },
      },
      ({ sessionId, ts, selector }) => {
        const handle = getDb();
        if (!handle) return textResult(NO_DB_MESSAGE);
        const ev = eventsFor(sessionId);
        if (!ev.ok) return textResult(ev.message);
        const snap = reconstructDomAt(ev.events, ts, selector);
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
        title: 'DOM change timeline',
        description:
          'Timeline of attribute and/or text changes over a session for the node matching a CSS selector - useful for tracking how one element evolved. Returns JSON { selector, changes }. Use op to restrict to attribute changes or innerText; omit for both.',
        inputSchema: {
          sessionId: z.string().describe('Session id from list_recent_sessions.'),
          selector: z
            .string()
            .describe("CSS selector for the node to track, e.g. '#status' or '.cart-count'."),
          op: z
            .enum(['attributeChanges', 'innerText'])
            .optional()
            .describe("Restrict to 'attributeChanges' or 'innerText'. Omit to include both."),
          limit: z
            .number()
            .int()
            .min(1)
            .max(500)
            .default(100)
            .describe('Maximum changes to return (1-500; default 100).'),
        },
        annotations: { readOnlyHint: true, openWorldHint: false },
      },
      ({ sessionId, selector, op, limit }) => {
        const handle = getDb();
        if (!handle) return textResult(NO_DB_MESSAGE);
        const ev = eventsFor(sessionId);
        if (!ev.ok) return textResult(ev.message);
        const changes = queryDomHistory(ev.events, selector, {
          limit,
          ...(op !== undefined ? { op } : {}),
        });
        return jsonResult({ selector, changes });
      },
    );

    // 9. request_authorization (Task 3.24) -----------------------------------
    // Level-3 confirmation step: the AI calls this to PROMPT the user via the
    // side-panel banner. The host bridges to the SW, which surfaces the
    // banner. On Allow the host returns a one-shot confirmToken the AI passes
    // to execute_action. EVERY call (including denied ones) is audit-logged.
    server.registerTool(
      'request_authorization',
      {
        title: 'Request action authorization',
        description:
          'Ask the user to authorize a browser action via the side-panel banner (Level-3 act-with-confirm). On Allow, returns a one-shot confirmToken to pass to execute_action; on Deny, returns the denial. Every call - allowed or denied - is recorded to ~/.peek/audit.log. Use before execute_action when the origin is at permission Level 3, or to pre-authorize.',
        inputSchema: {
          sessionId: z
            .string()
            .describe(
              'Session id (origin context) from list_recent_sessions; determines the per-origin permission level.',
            ),
          action: ActionSchema.describe(
            'The browser action to authorize (e.g. click/type/navigate; see the action schema).',
          ),
        },
        annotations: {
          readOnlyHint: false,
          destructiveHint: false,
          idempotentHint: false,
          openWorldHint: true,
        },
      },
      async ({ sessionId, action }) => {
        return await dispatchActTool({
          tool: 'request_authorization',
          sessionId,
          action,
        });
      },
    );

    // 10. execute_action (Task 3.24) -----------------------------------------
    // The actual DOM mutation. Gated by the per-origin permission level;
    // destructive blocklist overrides Level 4. confirmToken (optional) is the
    // token returned by a prior request_authorization, used to skip the
    // banner step at Level 3. Without it: Level 3 raises a banner; Level 4
    // proceeds (unless destructive); Level <3 denies.
    server.registerTool(
      'execute_action',
      {
        title: 'Execute a browser action',
        description:
          "Execute an action (click/type/navigate/...) in the user's live browser. Requires per-origin permission Level 3+: Level 3 raises a confirm banner unless a valid confirmToken from request_authorization is passed; Level 4 auto-allows non-destructive actions; Level <3 denies. The destructive-action override (delete/remove/transfer/send/pay/purchase/buy/confirm/subscribe/logout/sign out/unsubscribe/cancel subscription/wire/withdraw) always prompts, even at Level 4. Every call is recorded to ~/.peek/audit.log.",
        inputSchema: {
          sessionId: z
            .string()
            .describe(
              'Session id (origin context) from list_recent_sessions; determines the per-origin permission level.',
            ),
          action: ActionSchema.describe(
            'The browser action to execute (e.g. click/type/navigate; see the action schema).',
          ),
          confirmToken: z
            .string()
            .optional()
            .describe(
              'One-shot token from a prior request_authorization Allow, to skip the Level-3 banner. Omit to trigger the banner (Level 3) or rely on Level-4 auto-allow.',
            ),
        },
        annotations: {
          readOnlyHint: false,
          destructiveHint: true,
          idempotentHint: false,
          openWorldHint: true,
        },
      },
      async ({ sessionId, action, confirmToken }) => {
        return await dispatchActTool({
          tool: 'execute_action',
          sessionId,
          action,
          ...(confirmToken !== undefined ? { confirmToken } : {}),
        });
      },
    );
  }

  // --- Act-tool dispatch (shared between execute_action + request_authorization) ---
  async function dispatchActTool(input: {
    tool: AuditTool;
    sessionId: string;
    action: import('./action-schema.js').Action;
    confirmToken?: string;
  }): Promise<ReturnType<typeof jsonResult>> {
    const bridge = options.hostBridge ?? new MissingHostBridge();
    const clientImpl = server.server.getClientVersion();
    const client = clientImpl?.name ?? 'unknown';
    const requestStartedAtMs = Date.now();

    let response: import('./host-bridge.js').HostActionResponse;
    let bridgeError: unknown;
    try {
      response = await bridge.request({
        tool: input.tool,
        sessionId: input.sessionId,
        action: input.action,
        client,
        ...(input.confirmToken !== undefined ? { confirmToken: input.confirmToken } : {}),
      });
    } catch (err) {
      bridgeError = err;
      // Synthesize a denied/error response so we still audit-log + return a
      // structured reply.
      response = {
        verdict: 'deny',
        result: 'error',
        approver: 'user',
        error: err instanceof Error ? err.message : String(err),
      };
    }

    // Audit-log the call — even when the bridge errored / denied. The audit
    // log is the trust surface and must never miss a write.
    const auditResult: AuditResult = response.result;
    let auditWriteFailed = false;
    try {
      const auditWriteOptions: AuditWriteOptions =
        options.auditLogPath !== undefined ? { path: options.auditLogPath } : {};
      recordAuditEntry(
        {
          tool: input.tool,
          action: input.action,
          approver: response.approver,
          client,
          sessionId: input.sessionId,
          result: auditResult,
          nowMs: requestStartedAtMs,
          ...(response.approvalMs !== undefined ? { approvalMs: response.approvalMs } : {}),
          ...(response.destructiveTerm !== undefined
            ? { destructiveTerm: response.destructiveTerm }
            : {}),
          ...(response.error !== undefined ? { error: response.error } : {}),
        },
        auditWriteOptions,
      );
    } catch (err) {
      auditWriteFailed = true;
      console.error(
        `peek-mcp: audit log write failed — ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    // Surface the result to the AI as JSON. confirmToken (when present) is
    // the only field the AI re-uses; the rest is for diagnostic display.
    //
    // If the audit-log write failed, downgrade the tool response to
    // `result: 'error'` so the AI sees the broken audit chain. The underlying
    // action may already have been dispatched by the SW (irreversible at this
    // point) — but the AI's view of the outcome must accurately reflect that
    // the audit chain was broken, since the audit log is the trust surface.
    const body: Record<string, unknown> = {
      tool: input.tool,
      verdict: response.verdict,
      result: auditWriteFailed ? 'error' : response.result,
      approver: response.approver,
    };
    if (response.confirmToken !== undefined) body.confirmToken = response.confirmToken;
    if (response.destructiveTerm !== undefined) body.destructiveTerm = response.destructiveTerm;
    if (auditWriteFailed) {
      body.error = 'audit log write failed';
    } else if (response.error !== undefined) {
      body.error = response.error;
    }
    if (response.details !== undefined) body.details = response.details;
    if (bridgeError !== undefined) {
      // Make sure errors propagate visibly to the AI as well.
      body.bridgeError = bridgeError instanceof Error ? bridgeError.message : String(bridgeError);
    }

    return jsonResult(body);
  }
}

/** The tool names this server registers, for smoke tests / docs. */
export const PEEK_MCP_TOOLS = [
  // Read tools (Phase 3c, Level 1+).
  'list_recent_sessions',
  'get_session_summary',
  'get_session_console_errors',
  'get_session_network_errors',
  'get_user_action_before_error',
  'generate_playwright_repro',
  'get_dom_snapshot',
  'query_dom_history',
  // Write tools (Phase 3d, Level 3+).
  'request_authorization',
  'execute_action',
] as const;
