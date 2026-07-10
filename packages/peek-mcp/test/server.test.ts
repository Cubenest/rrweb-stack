import { EventEmitter } from 'node:events';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { compress } from '@cubenest/rrweb-core';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openDb } from '../src/db/open.js';
import { LocalSocketHostBridge, RegistryBackedHostBridge } from '../src/mcp/host-bridge.js';
import { PEEK_MCP_TOOLS, createPeekMcpServer } from '../src/mcp/server.js';
import type { ActionResultMessage } from '../src/native-host/action-protocol.js';
import { HostSocketServer } from '../src/native-host/host-socket.js';
import { EMPTY_POLICY } from '../src/native-host/policy.js';
import {
  clickEvent,
  documentWith,
  el,
  freshIds,
  fullSnapshot,
  inputEvent,
  metaNav,
  mutationEvent,
  text,
} from './fixtures/rrweb.js';
import { seedStore } from './fixtures/seed.js';

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'peek-mcp-srv-'));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

/** Build a login-flow session fixture (events + one console error). */
function loginSession() {
  freshIds();
  const email = el('input', { attributes: { name: 'email' } });
  const submit = el('button', { attributes: { id: 'login' } });
  const root = documentWith([email, submit]);
  const events = [
    metaNav('https://app.test/login', 1000),
    fullSnapshot(root, 1000),
    inputEvent(email.id, 'me@x.com', 1100),
    clickEvent(submit.id, 1200),
  ];
  return {
    id: 's_login',
    createdAt: '2026-05-26T00:00:00.000Z',
    updatedAt: '2026-05-26T00:02:00.000Z',
    url: 'https://app.test/login',
    title: 'Login flow',
    origin: 'https://app.test',
    events,
    consoleErrors: [{ ts: 1300, message: 'TypeError: x is undefined', stack: 'at foo()' }],
    networkErrors: [{ ts: 1250, method: 'POST', url: 'https://app.test/api/login', status: 500 }],
  };
}

/**
 * Seed a MULTI-CHUNK session into an already-seeded store so the server's range
 * loader (loadEventsUpToTs) has an `events_chunks` index to exploit. Writes one
 * gzipped `<seq>.json.gz` per chunk under `<eventsDir>/<sid>/`, an `events_chunks`
 * row per chunk (FK → sessions, includes `created_at`), and a `sessions` row
 * whose `events_blob_path` is the chunk DIRECTORY (`<sid>`). Re-opens the same
 * dbPath the harness built, writably, and closes before the server connects
 * read-only on its first tool call (lazy getDb).
 */
function seedMultiChunkSession(
  store: { dbPath: string; eventsDir: string },
  sid: string,
  chunks: Array<{ timestamp: number }[]>,
): void {
  const db = openDb({ path: store.dbPath });
  try {
    const now = '2026-05-27T00:00:00.000Z';
    db.prepare(
      `INSERT INTO sessions
         (id, created_at, updated_at, url, title, origin, events_blob_path, event_count, bytes, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, 'finalized')`,
    ).run(
      sid,
      now,
      now,
      'https://app.test/mc',
      'Multi-chunk',
      'https://app.test',
      sid, // events_blob_path = the chunk directory (relative to eventsDir)
      chunks.reduce((n, c) => n + c.length, 0),
    );
    const chunkDir = join(store.eventsDir, sid);
    mkdirSync(chunkDir, { recursive: true });
    chunks.forEach((events, seq) => {
      writeFileSync(join(chunkDir, `${seq}.json.gz`), compress(events as never));
      const ts = events.map((e) => e.timestamp);
      db.prepare(
        `INSERT INTO events_chunks
           (session_id, seq, start_ts_ms, end_ts_ms, event_count, byte_offset, byte_length, created_at)
         VALUES (?, ?, ?, ?, ?, 0, 0, ?)`,
      ).run(sid, seq, Math.min(...ts), Math.max(...ts), events.length, now);
    });
  } finally {
    db.close();
  }
}

/** Connect an in-memory client to a freshly-built server over the seeded store. */
async function connectClient(opts: {
  dbPath?: string;
  eventsDir?: string;
  withRoots?: boolean;
  hostBridge?: RegistryBackedHostBridge;
  auditLogPath?: string;
  clientName?: string;
}): Promise<{
  client: Client;
  close: () => Promise<void>;
  bridge: RegistryBackedHostBridge | undefined;
}> {
  const peek = createPeekMcpServer({
    ...(opts.dbPath !== undefined ? { dbPath: opts.dbPath } : {}),
    ...(opts.eventsDir !== undefined ? { eventsDir: opts.eventsDir } : {}),
    ...(opts.hostBridge !== undefined ? { hostBridge: opts.hostBridge } : {}),
    ...(opts.auditLogPath !== undefined ? { auditLogPath: opts.auditLogPath } : {}),
  });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: opts.clientName ?? 'test-client', version: '0.0.0' });
  if (opts.withRoots) client.registerCapabilities({ roots: {} });

  await Promise.all([peek.server.connect(serverTransport), client.connect(clientTransport)]);
  return {
    client,
    close: async () => {
      await client.close();
      peek.close();
    },
    bridge: opts.hostBridge,
  };
}

/** Parse the first text content block of a tool result as JSON. */
function parseJson(result: { content: Array<{ type: string; text?: string }> }): unknown {
  const block = result.content.find((c) => c.type === 'text');
  return JSON.parse(block?.text ?? 'null');
}

function textOf(result: { content: Array<{ type: string; text?: string }> }): string {
  return result.content.find((c) => c.type === 'text')?.text ?? '';
}

describe('peek MCP server: tools/list', () => {
  it('lists exactly the documented tool surface (8 read + search_sessions + render_session_journey + 2 live read + 2 write + 2 suggest + 1 handoff + set_intent + verify_audit_log)', async () => {
    const { dbPath, eventsDir } = seedStore(dir, [loginSession()]);
    const { client, close } = await connectClient({ dbPath, eventsDir });
    try {
      const { tools } = await client.listTools();
      const names = tools.map((t) => t.name).sort();
      expect(names).toEqual([...PEEK_MCP_TOOLS].sort());
      // Phase 3d landed the two Level-3+ act tools; they MUST appear.
      expect(names).toContain('execute_action');
      expect(names).toContain('request_authorization');
      expect(names).toContain('suggest_element');
      expect(names).toContain('clear_highlight');
      expect(names).toContain('request_user_input');
      expect(names).toContain('set_intent');
    } finally {
      await close();
    }
  });
});

describe('peek MCP server: read tools over a seeded store', () => {
  it('list_recent_sessions returns compact rows with ids + errorCount', async () => {
    const { dbPath, eventsDir } = seedStore(dir, [loginSession()]);
    const { client, close } = await connectClient({ dbPath, eventsDir });
    try {
      const res = await client.callTool({ name: 'list_recent_sessions', arguments: { limit: 5 } });
      const rows = parseJson(res as never) as Array<Record<string, unknown>>;
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ id: 's_login', origin: 'https://app.test' });
      // one console error + one network error.
      expect(rows[0]?.errorCount).toBe(2);
      expect(rows[0]?.durationMs).toBe(120000);
    } finally {
      await close();
    }
  });

  it('get_session_summary returns a narrative with click/input tallies', async () => {
    const { dbPath, eventsDir } = seedStore(dir, [loginSession()]);
    const { client, close } = await connectClient({ dbPath, eventsDir });
    try {
      const res = await client.callTool({
        name: 'get_session_summary',
        arguments: { sessionId: 's_login' },
      });
      const summary = parseJson(res as never) as Record<string, unknown>;
      expect(summary).toMatchObject({ id: 's_login', clicks: 1, inputs: 1 });
      expect(summary.narrative).toContain('Login flow');
      expect(String(summary.narrative)).toContain('1 click');
    } finally {
      await close();
    }
  });

  it('get_session_console_errors returns rows with ids usable by drill-in', async () => {
    const { dbPath, eventsDir } = seedStore(dir, [loginSession()]);
    const { client, close } = await connectClient({ dbPath, eventsDir });
    try {
      const res = await client.callTool({
        name: 'get_session_console_errors',
        arguments: { sessionId: 's_login' },
      });
      const rows = parseJson(res as never) as Array<Record<string, unknown>>;
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ level: 'error', message: 'TypeError: x is undefined' });
      expect(typeof rows[0]?.id).toBe('number');
    } finally {
      await close();
    }
  });

  it('get_session_network_errors returns the 500', async () => {
    const { dbPath, eventsDir } = seedStore(dir, [loginSession()]);
    const { client, close } = await connectClient({ dbPath, eventsDir });
    try {
      const res = await client.callTool({
        name: 'get_session_network_errors',
        arguments: { sessionId: 's_login' },
      });
      const rows = parseJson(res as never) as Array<Record<string, unknown>>;
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ status: 500, method: 'POST' });
    } finally {
      await close();
    }
  });

  it('get_user_action_before_error walks back from the error timestamp', async () => {
    const { dbPath, eventsDir } = seedStore(dir, [loginSession()]);
    const { client, close } = await connectClient({ dbPath, eventsDir });
    try {
      // First fetch the console error id.
      const errs = parseJson(
        (await client.callTool({
          name: 'get_session_console_errors',
          arguments: { sessionId: 's_login' },
        })) as never,
      ) as Array<{ id: number }>;
      expect(errs.length).toBeGreaterThan(0);
      const errorId = errs[0]?.id ?? -1;

      const res = await client.callTool({
        name: 'get_user_action_before_error',
        arguments: { sessionId: 's_login', errorId, window: 5 },
      });
      const out = parseJson(res as never) as { actions: Array<Record<string, unknown>> };
      // The input + click both precede the 1300 error.
      expect(out.actions.map((a) => a.type)).toEqual(['navigate', 'input', 'click']);
      expect(out.actions.find((a) => a.type === 'click')?.selector).toBe('#login');
    } finally {
      await close();
    }
  });

  it('generate_playwright_repro returns a Playwright test string', async () => {
    const { dbPath, eventsDir } = seedStore(dir, [loginSession()]);
    const { client, close } = await connectClient({ dbPath, eventsDir });
    try {
      const res = await client.callTool({
        name: 'generate_playwright_repro',
        arguments: { sessionId: 's_login' },
      });
      const script = textOf(res as never);
      expect(script).toContain("import { test, expect } from '@playwright/test';");
      expect(script).toContain("await page.goto('https://app.test/login');");
      expect(script).toContain("await page.locator('input[name=\"email\"]').fill('me@x.com');");
      expect(script).toContain("await page.locator('#login').click();");
    } finally {
      await close();
    }
  });

  it('get_dom_snapshot reconstructs HTML at a timestamp', async () => {
    const { dbPath, eventsDir } = seedStore(dir, [loginSession()]);
    const { client, close } = await connectClient({ dbPath, eventsDir });
    try {
      const res = await client.callTool({
        name: 'get_dom_snapshot',
        arguments: { sessionId: 's_login', ts: 1200 },
      });
      const out = parseJson(res as never) as { html: string; baseSnapshotTs: number };
      expect(out.baseSnapshotTs).toBe(1000);
      expect(out.html).toContain('<button id="login">');
      expect(out.html).toContain('<input name="email">');
    } finally {
      await close();
    }
  });

  it('get_dom_snapshot reconstructs from the range loader over a multi-chunk session', async () => {
    const store = seedStore(dir, [loginSession()]);
    // chunk0 = FullSnapshot(<h1>A</h1>)@100; chunk1 = attr-mutation on the h1
    // (id 2) @200; chunk2 = FullSnapshot(<h1>B</h1>)@300. For ts 250 the base is
    // the t100 snapshot with the t200 attribute mutation applied — i.e. the
    // range loader must load chunk0 + chunk1 (and NOT need chunk2) and yield the
    // same reconstruction whole-load would.
    freshIds(); // text('A')=id1, h1=id2, body=id3, html=id4, doc=id5
    const chunk0 = [fullSnapshot(documentWith([el('h1', { children: [text('A')] })]), 100)];
    const chunk1 = [
      mutationEvent({ attributes: [{ id: 2, attributes: { 'data-step': '1' } }] }, 200),
    ];
    freshIds();
    const chunk2 = [fullSnapshot(documentWith([el('h1', { children: [text('B')] })]), 300)];
    seedMultiChunkSession(store, 's_mc', [chunk0, chunk1, chunk2]);

    const { client, close } = await connectClient(store);
    try {
      const res = await client.callTool({
        name: 'get_dom_snapshot',
        arguments: { sessionId: 's_mc', ts: 250 },
      });
      const out = parseJson(res as never) as { html: string; baseSnapshotTs: number };
      // Base is the t100 (A) snapshot — NOT the later t300 (B) one.
      expect(out.baseSnapshotTs).toBe(100);
      // The t200 attribute mutation is applied on top of the t100 tree.
      expect(out.html).toContain('data-step="1"');
      expect(out.html).toContain('A');
      expect(out.html).not.toContain('B');
    } finally {
      await close();
    }
  });

  it('query_dom_history returns [] for a selector with no recorded changes', async () => {
    const { dbPath, eventsDir } = seedStore(dir, [loginSession()]);
    const { client, close } = await connectClient({ dbPath, eventsDir });
    try {
      const res = await client.callTool({
        name: 'query_dom_history',
        arguments: { sessionId: 's_login', selector: '#login' },
      });
      const out = parseJson(res as never) as { changes: unknown[] };
      expect(out.changes).toEqual([]);
    } finally {
      await close();
    }
  });
});

describe('peek MCP server: graceful no-DB', () => {
  it('tools return a clear message when no store exists yet', async () => {
    const { client, close } = await connectClient({
      dbPath: join(dir, 'does-not-exist.db'),
      eventsDir: join(dir, 'rrweb-events'),
    });
    try {
      // tools/list still works (8 read + search_sessions + render_session_journey + get_page_view + get_element_detail + 2 write + 2 suggest + 1 handoff + set_intent + verify_audit_log + request_pairing + share_session).
      const { tools } = await client.listTools();
      expect(tools).toHaveLength(21);
      // and a call returns the friendly message rather than erroring.
      const res = await client.callTool({ name: 'list_recent_sessions', arguments: {} });
      expect(textOf(res as never)).toContain('No sessions recorded yet');
    } finally {
      await close();
    }
  });

  it('unknown session id returns a not-found message', async () => {
    const { dbPath, eventsDir } = seedStore(dir, [loginSession()]);
    const { client, close } = await connectClient({ dbPath, eventsDir });
    try {
      const res = await client.callTool({
        name: 'get_session_summary',
        arguments: { sessionId: 's_nope' },
      });
      expect(textOf(res as never)).toContain("No session found with id 's_nope'");
    } finally {
      await close();
    }
  });

  it('a corrupt event blob yields a clean tool error, not a crash', async () => {
    const { dbPath, eventsDir } = seedStore(dir, [loginSession()]);
    // Overwrite the session's blob with garbage so decompress fails.
    writeFileSync(join(eventsDir, 's_login.rrweb.gz'), Buffer.from([0x1f, 0x8b, 0xff, 0x00, 0x01]));
    const { client, close } = await connectClient({ dbPath, eventsDir });
    try {
      // An event-using tool surfaces the decode failure as a clean text result.
      const res = await client.callTool({
        name: 'get_dom_snapshot',
        arguments: { sessionId: 's_login', ts: 1200 },
      });
      expect(textOf(res as never)).toContain('Failed to decode the event blob');
      // A SQL-only tool is unaffected by the corrupt blob.
      const errs = await client.callTool({
        name: 'get_session_console_errors',
        arguments: { sessionId: 's_login' },
      });
      expect(parseJson(errs as never)).toHaveLength(1);
    } finally {
      await close();
    }
  });
});

describe('peek MCP server: roots scoping', () => {
  it('falls back to unscoped (all sessions) when the client has no roots capability', async () => {
    const { dbPath, eventsDir } = seedStore(dir, [loginSession()]);
    const peek = createPeekMcpServer({ dbPath, eventsDir });
    const [ct, st] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: 'no-roots', version: '0.0.0' });
    await Promise.all([peek.server.connect(st), client.connect(ct)]);
    try {
      // Give oninitialized a tick to run.
      await new Promise((r) => setTimeout(r, 20));
      expect(peek.rootsScope?.reason).toBe('no-roots-capability');
      expect(peek.rootsScope?.allowedOrigins).toBeUndefined();
    } finally {
      await client.close();
      peek.close();
    }
  });
});

// --- Act tools (Task 3.24) ---------------------------------------------------

describe('peek MCP server: request_authorization (Task 3.24)', () => {
  it('routes through the host bridge and writes ONE audit-log line', async () => {
    const { dbPath, eventsDir } = seedStore(dir, [loginSession()]);
    const auditLogPath = join(dir, 'audit.log');
    const bridge = new RegistryBackedHostBridge();
    const { client, close } = await connectClient({
      dbPath,
      eventsDir,
      hostBridge: bridge,
      auditLogPath,
      clientName: 'cursor',
    });
    try {
      // Fire the tool call but don't await yet — drive the bridge first.
      const callP = client.callTool({
        name: 'request_authorization',
        arguments: {
          sessionId: 's_login',
          action: { type: 'click', selector: '#login' },
        },
      });

      // The bridge has one pending request; simulate the SW replying.
      // Poll briefly because the call is async (the MCP request flight
      // happens over the in-memory transport).
      for (let i = 0; i < 20 && bridge.pending.length === 0; i++) {
        await new Promise((r) => setTimeout(r, 5));
      }
      expect(bridge.pending).toHaveLength(1);
      expect(bridge.pending[0]?.req.tool).toBe('request_authorization');
      expect(bridge.pending[0]?.req.client).toBe('cursor');
      bridge.resolveNext({
        verdict: 'allow',
        result: 'ok',
        approver: 'user',
        approvalMs: 1716480000000,
        confirmToken: 'tok_abc',
      });

      const res = await callP;
      const body = parseJson(res as never) as Record<string, unknown>;
      expect(body.tool).toBe('request_authorization');
      expect(body.verdict).toBe('allow');
      expect(body.result).toBe('ok');
      expect(body.approver).toBe('user');
      expect(body.confirmToken).toBe('tok_abc');

      // Audit log appended exactly one line.
      const contents = require('node:fs').readFileSync(auditLogPath, 'utf8');
      const lines = contents.split('\n').filter((l: string) => l.length > 0);
      expect(lines).toHaveLength(1);
      const entry = JSON.parse(lines[0]);
      expect(entry.tool).toBe('request_authorization');
      expect(entry.client).toBe('cursor');
      expect(entry.sessionId).toBe('s_login');
      expect(entry.approver).toBe('user');
      expect(entry.result).toBe('ok');
      expect(entry.approvalTs).toBe('2024-05-23T16:00:00.000Z');
    } finally {
      await close();
    }
  });
});

describe('peek MCP server: execute_action (Task 3.24)', () => {
  it('passes confirmToken through + audit-logs an ok result', async () => {
    const { dbPath, eventsDir } = seedStore(dir, [loginSession()]);
    const auditLogPath = join(dir, 'audit.log');
    const bridge = new RegistryBackedHostBridge();
    const { client, close } = await connectClient({
      dbPath,
      eventsDir,
      hostBridge: bridge,
      auditLogPath,
      clientName: 'claude-code',
    });
    try {
      const callP = client.callTool({
        name: 'execute_action',
        arguments: {
          sessionId: 's_login',
          action: { type: 'click', selector: '#login' },
          confirmToken: 'tok_abc',
        },
      });

      for (let i = 0; i < 20 && bridge.pending.length === 0; i++) {
        await new Promise((r) => setTimeout(r, 5));
      }
      expect(bridge.pending[0]?.req.tool).toBe('execute_action');
      expect(bridge.pending[0]?.req.confirmToken).toBe('tok_abc');
      bridge.resolveNext({
        verdict: 'allow',
        result: 'ok',
        approver: 'user',
        approvalMs: 1716480001000,
        details: { dispatched: true },
      });

      const res = await callP;
      const body = parseJson(res as never) as Record<string, unknown>;
      expect(body.verdict).toBe('allow');
      expect(body.result).toBe('ok');

      const contents = require('node:fs').readFileSync(auditLogPath, 'utf8');
      const entry = JSON.parse(contents.trim());
      expect(entry.tool).toBe('execute_action');
      expect(entry.client).toBe('claude-code');
    } finally {
      await close();
    }
  });

  it('redacts TypeAction.text in the audit log (defense in depth)', async () => {
    const { dbPath, eventsDir } = seedStore(dir, [loginSession()]);
    const auditLogPath = join(dir, 'audit.log');
    const bridge = new RegistryBackedHostBridge();
    const { client, close } = await connectClient({
      dbPath,
      eventsDir,
      hostBridge: bridge,
      auditLogPath,
    });
    try {
      const callP = client.callTool({
        name: 'execute_action',
        arguments: {
          sessionId: 's_login',
          action: { type: 'type', selector: '#password', text: 'hunter2' },
        },
      });
      for (let i = 0; i < 20 && bridge.pending.length === 0; i++) {
        await new Promise((r) => setTimeout(r, 5));
      }
      bridge.resolveNext({ verdict: 'allow', result: 'ok', approver: 'user' });
      await callP;
      const contents = require('node:fs').readFileSync(auditLogPath, 'utf8');
      const entry = JSON.parse(contents.trim());
      expect(entry.args.text).toBe('<<REDACTED>>');
      expect(entry.args.selector).toBe('#password'); // selector NOT redacted
    } finally {
      await close();
    }
  });

  it('logs a denied result with the destructiveTerm when the SW refused', async () => {
    const { dbPath, eventsDir } = seedStore(dir, [loginSession()]);
    const auditLogPath = join(dir, 'audit.log');
    const bridge = new RegistryBackedHostBridge();
    const { client, close } = await connectClient({
      dbPath,
      eventsDir,
      hostBridge: bridge,
      auditLogPath,
    });
    try {
      const callP = client.callTool({
        name: 'execute_action',
        arguments: {
          sessionId: 's_login',
          action: { type: 'click', selector: '#delete' },
        },
      });
      for (let i = 0; i < 20 && bridge.pending.length === 0; i++) {
        await new Promise((r) => setTimeout(r, 5));
      }
      bridge.resolveNext({
        verdict: 'deny',
        result: 'denied',
        approver: 'user',
        destructiveTerm: 'delete',
        error: 'User denied destructive action',
      });
      const res = await callP;
      const body = parseJson(res as never) as Record<string, unknown>;
      expect(body.verdict).toBe('deny');
      expect(body.result).toBe('denied');
      expect(body.destructiveTerm).toBe('delete');
      expect(body.error).toBe('User denied destructive action');
      const contents = require('node:fs').readFileSync(auditLogPath, 'utf8');
      const entry = JSON.parse(contents.trim());
      expect(entry.result).toBe('denied');
      expect(entry.destructiveTerm).toBe('delete');
    } finally {
      await close();
    }
  });

  it('falls through with denied/error when no bridge is wired (MissingHostBridge default)', async () => {
    const { dbPath, eventsDir } = seedStore(dir, [loginSession()]);
    const auditLogPath = join(dir, 'audit.log');
    // No hostBridge → MissingHostBridge default kicks in.
    const { client, close } = await connectClient({ dbPath, eventsDir, auditLogPath });
    try {
      const res = await client.callTool({
        name: 'execute_action',
        arguments: {
          sessionId: 's_login',
          action: { type: 'reload' },
        },
      });
      const body = parseJson(res as never) as Record<string, unknown>;
      expect(body.verdict).toBe('deny');
      expect(body.result).toBe('denied');
      expect(String(body.error)).toContain('native-host bridge not wired');
      // Audit log still recorded the attempt.
      const contents = require('node:fs').readFileSync(auditLogPath, 'utf8');
      expect(contents.split('\n').filter((l: string) => l.length > 0)).toHaveLength(1);
    } finally {
      await close();
    }
  });

  it("downgrades the tool result to 'error' when the audit log write fails", async () => {
    const { dbPath, eventsDir } = seedStore(dir, [loginSession()]);
    // Make the audit log path a DIRECTORY so the writer (writeFileSync to
    // seed mode 0o600 OR appendFileSync) errors with EISDIR.
    const auditLogPath = join(dir, 'audit.log');
    mkdirSync(auditLogPath);
    const bridge = new RegistryBackedHostBridge();
    const { client, close } = await connectClient({
      dbPath,
      eventsDir,
      hostBridge: bridge,
      auditLogPath,
    });
    try {
      const callP = client.callTool({
        name: 'execute_action',
        arguments: {
          sessionId: 's_login',
          action: { type: 'click', selector: '#login' },
        },
      });
      for (let i = 0; i < 20 && bridge.pending.length === 0; i++) {
        await new Promise((r) => setTimeout(r, 5));
      }
      // SW happily allowed — but the audit-log write will fail.
      bridge.resolveNext({
        verdict: 'allow',
        result: 'ok',
        approver: 'user',
      });
      const res = await callP;
      const body = parseJson(res as never) as Record<string, unknown>;
      // The verdict from the SW is preserved (the action ran), but the result
      // is downgraded to 'error' so the AI sees the broken audit chain.
      expect(body.verdict).toBe('allow');
      expect(body.result).toBe('error');
      expect(body.error).toBe('audit log write failed');
      // Approver is preserved (per the brief).
      expect(body.approver).toBe('user');
    } finally {
      await close();
    }
  });

  it('Zod rejects malformed action input at the tool boundary', async () => {
    const { dbPath, eventsDir } = seedStore(dir, [loginSession()]);
    const bridge = new RegistryBackedHostBridge();
    const { client, close } = await connectClient({ dbPath, eventsDir, hostBridge: bridge });
    try {
      const res = await client.callTool({
        name: 'execute_action',
        arguments: {
          sessionId: 's_login',
          // Invalid button enum → zod rejects at the tool boundary. (A bare
          // `{type:'click'}` is now VALID — selector is optional, ref-or-selector
          // is enforced at dispatch — so use a genuinely malformed field here.)
          action: { type: 'click', button: 'turbo' },
        },
      });
      // The SDK returns { isError: true } for input validation failures.
      expect((res as { isError?: boolean }).isError).toBe(true);
      // No bridge dispatch should have happened — validation failed first.
      expect(bridge.pending).toHaveLength(0);
    } finally {
      await close();
    }
  });
});

describe('peek MCP server: suggest_element + clear_highlight dispatch', () => {
  it('suggest_element WITH a label dispatches a highlight action carrying the label', async () => {
    const { dbPath, eventsDir } = seedStore(dir, [loginSession()]);
    const bridge = new RegistryBackedHostBridge();
    const { client, close } = await connectClient({ dbPath, eventsDir, hostBridge: bridge });
    try {
      const callP = client.callTool({
        name: 'suggest_element',
        arguments: { sessionId: 's_login', selector: '#login', label: 'Click here' },
      });
      for (let i = 0; i < 20 && bridge.pending.length === 0; i++) {
        await new Promise((r) => setTimeout(r, 5));
      }
      // Routed through the execute_action audit path on the wire.
      expect(bridge.pending[0]?.req.tool).toBe('execute_action');
      expect(bridge.pending[0]?.req.action).toEqual({
        type: 'highlight',
        selector: '#login',
        label: 'Click here',
      });
      bridge.resolveNext({ verdict: 'allow', result: 'ok', approver: 'level-2-suggest' });
      await callP;
    } finally {
      await close();
    }
  });

  it('suggest_element WITHOUT a label omits the label key entirely', async () => {
    const { dbPath, eventsDir } = seedStore(dir, [loginSession()]);
    const bridge = new RegistryBackedHostBridge();
    const { client, close } = await connectClient({ dbPath, eventsDir, hostBridge: bridge });
    try {
      const callP = client.callTool({
        name: 'suggest_element',
        arguments: { sessionId: 's_login', selector: '#login' },
      });
      for (let i = 0; i < 20 && bridge.pending.length === 0; i++) {
        await new Promise((r) => setTimeout(r, 5));
      }
      const action = bridge.pending[0]?.req.action as Record<string, unknown>;
      // Locks the `...(label !== undefined ? { label } : {})` spread: no key.
      expect(action).toEqual({ type: 'highlight', selector: '#login' });
      expect('label' in action).toBe(false);
      bridge.resolveNext({ verdict: 'allow', result: 'ok', approver: 'level-2-suggest' });
      await callP;
    } finally {
      await close();
    }
  });

  it('clear_highlight dispatches a clear_highlight action', async () => {
    const { dbPath, eventsDir } = seedStore(dir, [loginSession()]);
    const bridge = new RegistryBackedHostBridge();
    const { client, close } = await connectClient({ dbPath, eventsDir, hostBridge: bridge });
    try {
      const callP = client.callTool({
        name: 'clear_highlight',
        arguments: { sessionId: 's_login' },
      });
      for (let i = 0; i < 20 && bridge.pending.length === 0; i++) {
        await new Promise((r) => setTimeout(r, 5));
      }
      expect(bridge.pending[0]?.req.tool).toBe('execute_action');
      expect(bridge.pending[0]?.req.action).toEqual({ type: 'clear_highlight' });
      bridge.resolveNext({ verdict: 'allow', result: 'ok', approver: 'level-2-suggest' });
      await callP;
    } finally {
      await close();
    }
  });
});

describe('peek MCP server: get_page_view dispatch (live ref-tagged snapshot)', () => {
  it('rides the execute_action path with {type:page_view} and surfaces details', async () => {
    const { dbPath, eventsDir } = seedStore(dir, [loginSession()]);
    const bridge = new RegistryBackedHostBridge();
    const { client, close } = await connectClient({ dbPath, eventsDir, hostBridge: bridge });
    try {
      const callP = client.callTool({
        name: 'get_page_view',
        arguments: { sessionId: 's_login', maxElements: 50 },
      });
      for (let i = 0; i < 20 && bridge.pending.length === 0; i++) {
        await new Promise((r) => setTimeout(r, 5));
      }
      expect(bridge.pending[0]?.req.tool).toBe('execute_action');
      expect(bridge.pending[0]?.req.action).toEqual({ type: 'page_view', maxElements: 50 });
      bridge.resolveNext({
        verdict: 'allow',
        result: 'ok',
        approver: 'level-1-read',
        details: {
          url: 'https://app/',
          title: 'App',
          count: 1,
          truncated: false,
          view: 'e1 button "Go"',
        },
      });
      const res = await callP;
      // The ref-tagged view is surfaced to the agent in the result body's details.
      expect(textOf(res as never)).toContain('e1 button');
      expect(textOf(res as never)).toContain('level-1-read');
    } finally {
      await close();
    }
  });
});

describe('peek MCP server: get_element_detail dispatch (on-demand single-element drill-in)', () => {
  it('rides the execute_action path with {type:element_detail,ref} and surfaces details', async () => {
    const { dbPath, eventsDir } = seedStore(dir, [loginSession()]);
    const bridge = new RegistryBackedHostBridge();
    const { client, close } = await connectClient({ dbPath, eventsDir, hostBridge: bridge });
    try {
      const callP = client.callTool({
        name: 'get_element_detail',
        arguments: { sessionId: 's_login', ref: 'e5' },
      });
      for (let i = 0; i < 20 && bridge.pending.length === 0; i++) {
        await new Promise((r) => setTimeout(r, 5));
      }
      expect(bridge.pending[0]?.req.tool).toBe('execute_action');
      expect(bridge.pending[0]?.req.action).toEqual({ type: 'element_detail', ref: 'e5' });
      bridge.resolveNext({
        verdict: 'allow',
        result: 'ok',
        approver: 'level-1-read',
        details: {
          ok: true,
          ref: 'e5',
          tag: 'button',
          role: 'button',
          name: 'Sign in',
          description: 'Submits the login form',
          effectiveAriaHidden: false,
          effectiveAriaDisabled: false,
          computedStyles: { display: 'inline-block', color: 'rgb(0, 0, 0)' },
          state: [],
        },
      });
      const res = await callP;
      // The full masked detail is surfaced to the agent in the result body's details.
      // jsonResult JSON.stringifies the entire body (including details), so all fields
      // from the details object appear verbatim in the result text.
      expect(textOf(res as never)).toContain('Sign in');
      expect(textOf(res as never)).toContain('level-1-read');
      const parsed = JSON.parse(textOf(res as never)) as {
        details?: { description?: string; computedStyles?: Record<string, string> };
      };
      expect(parsed.details?.description).toBe('Submits the login form');
      expect(parsed.details?.computedStyles?.display).toBe('inline-block');
    } finally {
      await close();
    }
  });
});

describe('peek MCP server: execute_action observe (diff-after-action viewDelta)', () => {
  it('accepts {observe:true} on a mutating action and surfaces details.viewDelta', async () => {
    const { dbPath, eventsDir } = seedStore(dir, [loginSession()]);
    const bridge = new RegistryBackedHostBridge();
    const { client, close } = await connectClient({ dbPath, eventsDir, hostBridge: bridge });
    try {
      const callP = client.callTool({
        name: 'execute_action',
        arguments: { sessionId: 's_login', action: { type: 'click', ref: 'e1', observe: true } },
      });
      for (let i = 0; i < 20 && bridge.pending.length === 0; i++) {
        await new Promise((r) => setTimeout(r, 5));
      }
      // `observe` threads through the execute_action action passthrough untouched
      // (button defaults to 'left' via the click schema).
      expect(bridge.pending[0]?.req.tool).toBe('execute_action');
      expect(bridge.pending[0]?.req.action).toEqual({
        type: 'click',
        ref: 'e1',
        button: 'left',
        observe: true,
      });
      bridge.resolveNext({
        verdict: 'allow',
        result: 'ok',
        approver: 'level-4-auto',
        details: {
          viewDelta: {
            url: 'https://app/',
            added: [],
            removed: [],
            changed: [{ ref: 'e2', role: 'status', name: 'Saved' }],
            truncated: false,
          },
        },
      });
      const res = await callP;
      // The delta of what changed is surfaced to the agent in details.viewDelta.
      expect(textOf(res as never)).toContain('viewDelta');
      expect(textOf(res as never)).toContain('Saved');
    } finally {
      await close();
    }
  });
});

describe('peek MCP server: set_intent dispatch (control-shield banner)', () => {
  it('set_intent rides the execute_action path with {type:set_intent,text}', async () => {
    const { dbPath, eventsDir } = seedStore(dir, [loginSession()]);
    const bridge = new RegistryBackedHostBridge();
    const { client, close } = await connectClient({ dbPath, eventsDir, hostBridge: bridge });
    try {
      const callP = client.callTool({
        name: 'set_intent',
        arguments: { sessionId: 's_login', text: 'Applying to Senior Frontend · step 2/4' },
      });
      for (let i = 0; i < 20 && bridge.pending.length === 0; i++) {
        await new Promise((r) => setTimeout(r, 5));
      }
      expect(bridge.pending[0]?.req.tool).toBe('execute_action');
      expect(bridge.pending[0]?.req.action).toEqual({
        type: 'set_intent',
        text: 'Applying to Senior Frontend · step 2/4',
      });
      bridge.resolveNext({ verdict: 'allow', result: 'ok', approver: 'level-4-auto' });
      await callP;
    } finally {
      await close();
    }
  });

  it('set_intent forwards status into the dispatched action', async () => {
    const { dbPath, eventsDir } = seedStore(dir, [loginSession()]);
    const bridge = new RegistryBackedHostBridge();
    const { client, close } = await connectClient({ dbPath, eventsDir, hostBridge: bridge });
    try {
      const callP = client.callTool({
        name: 'set_intent',
        arguments: { sessionId: 's_login', text: 'Submitted', status: 'done' },
      });
      for (let i = 0; i < 20 && bridge.pending.length === 0; i++) {
        await new Promise((r) => setTimeout(r, 5));
      }
      expect(bridge.pending[0]?.req.tool).toBe('execute_action');
      expect(bridge.pending[0]?.req.action).toEqual({
        type: 'set_intent',
        text: 'Submitted',
        status: 'done',
      });
      bridge.resolveNext({ verdict: 'allow', result: 'ok', approver: 'level-4-auto' });
      await callP;
    } finally {
      await close();
    }
  });

  it('set_intent without status dispatches an action with no status key', async () => {
    const { dbPath, eventsDir } = seedStore(dir, [loginSession()]);
    const bridge = new RegistryBackedHostBridge();
    const { client, close } = await connectClient({ dbPath, eventsDir, hostBridge: bridge });
    try {
      const callP = client.callTool({
        name: 'set_intent',
        arguments: { sessionId: 's_login', text: 'step 2/4' },
      });
      for (let i = 0; i < 20 && bridge.pending.length === 0; i++) {
        await new Promise((r) => setTimeout(r, 5));
      }
      const action = bridge.pending[0]?.req.action as Record<string, unknown>;
      expect(action).toEqual({ type: 'set_intent', text: 'step 2/4' });
      expect('status' in action).toBe(false);
      bridge.resolveNext({ verdict: 'allow', result: 'ok', approver: 'level-4-auto' });
      await callP;
    } finally {
      await close();
    }
  });
});

describe('peek MCP server: request_user_input (Plan B input handoff)', () => {
  /**
   * A fake HostBridge that records every request (so we can assert the action
   * shape + the per-request bridge timeout) and returns a canned response.
   * Mirrors the plan's `fakeBridge`, adapted to the file's connectClient harness.
   */
  class RecordingHostBridge {
    readonly calls: Array<{
      action: { type: string; timeoutMs?: number; prompt?: string };
      timeoutMs?: number;
    }> = [];
    #response: import('../src/mcp/host-bridge.js').HostActionResponse;
    constructor(response: import('../src/mcp/host-bridge.js').HostActionResponse) {
      this.#response = response;
    }
    async request(
      req: import('../src/mcp/host-bridge.js').HostActionRequest,
    ): Promise<import('../src/mcp/host-bridge.js').HostActionResponse> {
      this.calls.push({
        action: req.action as { type: string; timeoutMs?: number; prompt?: string },
        ...(req.timeoutMs !== undefined ? { timeoutMs: req.timeoutMs } : {}),
      });
      return this.#response;
    }
  }

  it('threads a bridge timeout > the action timeoutMs and returns details', async () => {
    const { dbPath, eventsDir } = seedStore(dir, [loginSession()]);
    const bridge = new RecordingHostBridge({
      verdict: 'allow',
      result: 'ok',
      approver: 'user',
      details: { resumed: true },
    });
    const { client, close } = await connectClient({
      dbPath,
      eventsDir,
      hostBridge: bridge as never,
    });
    try {
      const res = await client.callTool({
        name: 'request_user_input',
        arguments: { sessionId: 's_login', prompt: 'Solve it', timeoutMs: 60000 },
      });
      expect(bridge.calls[0]?.action).toMatchObject({
        type: 'request_user_input',
        prompt: 'Solve it',
        timeoutMs: 60000,
      });
      // The bridge must wait LONGER than the handoff so the SW controller's
      // timer fires first → structured {resumed:false,'timeout'} (not a
      // transport error).
      expect(bridge.calls[0]?.timeoutMs).toBeGreaterThan(60000);
      const body = parseJson(res as never) as Record<string, unknown>;
      expect(body.details).toMatchObject({ resumed: true });
    } finally {
      await close();
    }
  });

  it('defaults the handoff timeout to 120000 and waits 30s longer on the bridge', async () => {
    const { dbPath, eventsDir } = seedStore(dir, [loginSession()]);
    const bridge = new RecordingHostBridge({
      verdict: 'allow',
      result: 'ok',
      approver: 'user',
      details: { resumed: false, reason: 'timeout' },
    });
    const { client, close } = await connectClient({
      dbPath,
      eventsDir,
      hostBridge: bridge as never,
    });
    try {
      await client.callTool({
        name: 'request_user_input',
        arguments: {
          sessionId: 's_login',
          prompt: 'Fill the field',
          selector: '#email',
          readBack: true,
        },
      });
      const action = bridge.calls[0]?.action as Record<string, unknown>;
      expect(action.timeoutMs).toBe(120000);
      expect(action.selector).toBe('#email');
      expect(action.readBack).toBe(true);
      // 120000 (handoff) + 30000 (margin).
      expect(bridge.calls[0]?.timeoutMs).toBe(150000);
    } finally {
      await close();
    }
  });

  it('omits the selector key entirely for a free-text prompt', async () => {
    const { dbPath, eventsDir } = seedStore(dir, [loginSession()]);
    const bridge = new RecordingHostBridge({
      verdict: 'allow',
      result: 'ok',
      approver: 'user',
      details: { resumed: true },
    });
    const { client, close } = await connectClient({
      dbPath,
      eventsDir,
      hostBridge: bridge as never,
    });
    try {
      await client.callTool({
        name: 'request_user_input',
        arguments: { sessionId: 's_login', prompt: 'Anything?' },
      });
      const action = bridge.calls[0]?.action as Record<string, unknown>;
      expect('selector' in action).toBe(false);
      expect(action.readBack).toBe(false);
    } finally {
      await close();
    }
  });

  it("defaults scope to 'field' when the param is omitted", async () => {
    const { dbPath, eventsDir } = seedStore(dir, [loginSession()]);
    const bridge = new RecordingHostBridge({
      verdict: 'allow',
      result: 'ok',
      approver: 'user',
      details: { resumed: true },
    });
    const { client, close } = await connectClient({
      dbPath,
      eventsDir,
      hostBridge: bridge as never,
    });
    try {
      await client.callTool({
        name: 'request_user_input',
        arguments: { sessionId: 's_login', prompt: 'Fill it' },
      });
      const action = bridge.calls[0]?.action as Record<string, unknown>;
      expect(action.scope).toBe('field');
    } finally {
      await close();
    }
  });

  it("forwards scope:'page' for a full-page takeover", async () => {
    const { dbPath, eventsDir } = seedStore(dir, [loginSession()]);
    const bridge = new RecordingHostBridge({
      verdict: 'allow',
      result: 'ok',
      approver: 'user',
      details: { resumed: true },
    });
    const { client, close } = await connectClient({
      dbPath,
      eventsDir,
      hostBridge: bridge as never,
    });
    try {
      await client.callTool({
        name: 'request_user_input',
        arguments: { sessionId: 's_login', prompt: 'Solve the CAPTCHA', scope: 'page' },
      });
      const action = bridge.calls[0]?.action as Record<string, unknown>;
      expect(action.scope).toBe('page');
    } finally {
      await close();
    }
  });
});

describe('peek MCP server: execute_action over the real LocalSocketHostBridge', () => {
  /**
   * Wire the REAL bridge → an in-memory duplex → the REAL HostSocketServer,
   * whose "browser side" (postToSw) immediately answers with a canned
   * action.result. This exercises the production IPC framing + relay end to end
   * (the only fakes are the socket transport itself + the SW reply).
   */
  function wireRealIpc(cannedResult: Omit<ActionResultMessage, 'requestId'>): {
    bridge: LocalSocketHostBridge;
  } {
    const toServer = new PassThrough();
    const toClient = new PassThrough();

    // The HostSocketServer's connection is fed bytes the bridge wrote (toServer)
    // and writes responses to the bridge's read stream (toClient).
    const serverConn = Object.assign(new EventEmitter(), {
      write: (b: string) => {
        toClient.write(b);
      },
    });
    toServer.on('data', (chunk: Buffer) => serverConn.emit('data', chunk));

    const server = new HostSocketServer({
      loadPolicy: () => EMPTY_POLICY,
      generateRequestId: () => 'rid-int-1',
      postToSw: () => {
        // The "browser" answers immediately with the canned result.
        server.onSwMessage({ ...cannedResult, requestId: 'rid-int-1' });
      },
      createServer: (onConnection) => {
        onConnection(serverConn as never);
        return { listen: () => {}, close: () => {} };
      },
    });
    server.listen();

    const bridge = new LocalSocketHostBridge({
      connect: () =>
        ({
          write: (b: string) => {
            toServer.write(b);
          },
          on: (e: string, h: (...a: unknown[]) => void) => {
            toClient.on(e, h);
          },
          end() {},
        }) as never,
    });
    return { bridge };
  }

  it('resolves an ok result with the same shape as the RegistryBacked path', async () => {
    const { dbPath, eventsDir } = seedStore(dir, [loginSession()]);
    const auditLogPath = join(dir, 'audit.log');
    const { bridge } = wireRealIpc({
      type: 'action.result',
      tool: 'execute_action',
      verdict: 'allow',
      result: 'ok',
      approver: 'user',
      approvalMs: 1716480002000,
      details: { dispatched: true },
    });
    const peek = createPeekMcpServer({ dbPath, eventsDir, hostBridge: bridge, auditLogPath });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: 'cursor', version: '0.0.0' });
    await Promise.all([peek.server.connect(serverTransport), client.connect(clientTransport)]);
    try {
      const res = await client.callTool({
        name: 'execute_action',
        arguments: {
          sessionId: 's_login',
          action: { type: 'click', selector: '#login' },
          confirmToken: 'tok_int',
        },
      });
      const body = parseJson(res as never) as Record<string, unknown>;
      expect(body.verdict).toBe('allow');
      expect(body.result).toBe('ok');
      expect(body.approver).toBe('user');
      expect(body.details).toEqual({ dispatched: true });
      // The audit log recorded the call through the real bridge.
      const entry = JSON.parse(readFileSync(auditLogPath, 'utf8').trim());
      expect(entry.tool).toBe('execute_action');
      expect(entry.result).toBe('ok');
    } finally {
      await client.close();
      peek.close();
    }
  });

  it('carries a request_authorization confirmToken back through the relay', async () => {
    const { dbPath, eventsDir } = seedStore(dir, [loginSession()]);
    const { bridge } = wireRealIpc({
      type: 'action.result',
      tool: 'request_authorization',
      verdict: 'allow',
      result: 'ok',
      approver: 'user',
      confirmToken: 'tok-from-sw',
    });
    const peek = createPeekMcpServer({ dbPath, eventsDir, hostBridge: bridge });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: 'cursor', version: '0.0.0' });
    await Promise.all([peek.server.connect(serverTransport), client.connect(clientTransport)]);
    try {
      const res = await client.callTool({
        name: 'request_authorization',
        arguments: { sessionId: 's_login', action: { type: 'click', selector: '#login' } },
      });
      const body = parseJson(res as never) as Record<string, unknown>;
      expect(body.confirmToken).toBe('tok-from-sw');
    } finally {
      await client.close();
      peek.close();
    }
  });
});

describe('peek MCP server: request_pairing tool (SP4)', () => {
  it('appears in the tool list', async () => {
    const { dbPath, eventsDir } = seedStore(dir, [loginSession()]);
    const { client, close } = await connectClient({ dbPath, eventsDir });
    try {
      const { tools } = await client.listTools();
      const names = tools.map((t) => t.name);
      expect(names).toContain('request_pairing');
    } finally {
      await close();
    }
  });

  it('approved pairing returns approved:true + secret', async () => {
    const { dbPath, eventsDir } = seedStore(dir, [loginSession()]);
    const auditLogPath = join(dir, 'audit-pairing.log');
    const bridge = new RegistryBackedHostBridge();
    const { client, close } = await connectClient({
      dbPath,
      eventsDir,
      hostBridge: bridge,
      auditLogPath,
    });
    try {
      const callP = client.callTool({
        name: 'request_pairing',
        arguments: { code: 'ABC-123' },
      });
      // Wait for the pairing request to arrive at the bridge.
      for (let i = 0; i < 20 && bridge.pendingPairings.length === 0; i++) {
        await new Promise((r) => setTimeout(r, 5));
      }
      expect(bridge.pendingPairings).toHaveLength(1);
      expect(bridge.pendingPairings[0]?.req.code).toBe('ABC-123');
      // Bridge: client name is derived from getClientVersion (test-client).
      expect(bridge.pendingPairings[0]?.req.clientName).toBe('test-client');
      bridge.resolveNextPairing({ approved: true, secret: 'tok_s3cr3t' });
      const res = await callP;
      const body = parseJson(res as never) as Record<string, unknown>;
      expect(body.approved).toBe(true);
      expect(body.secret).toBe('tok_s3cr3t');
      // The audit log was written for this pairing attempt.
      const lines = readFileSync(auditLogPath, 'utf8').split('\n').filter(Boolean);
      expect(lines).toHaveLength(1);
      const entry = JSON.parse(lines[0] ?? '') as Record<string, unknown>;
      expect(entry.tool).toBe('request_pairing');
      expect(entry.result).toBe('ok');
      expect(entry.client).toBe('test-client');
      // CRITICAL: the secret must NOT appear in the audit log.
      expect(lines[0]).not.toContain('tok_s3cr3t');
      expect(lines[0]).not.toContain('secret');
    } finally {
      await close();
    }
  });

  it('denied pairing returns approved:false with no secret', async () => {
    const { dbPath, eventsDir } = seedStore(dir, [loginSession()]);
    const auditLogPath = join(dir, 'audit-pairing-deny.log');
    const bridge = new RegistryBackedHostBridge();
    const { client, close } = await connectClient({
      dbPath,
      eventsDir,
      hostBridge: bridge,
      auditLogPath,
    });
    try {
      const callP = client.callTool({
        name: 'request_pairing',
        arguments: { code: 'XYZ-999' },
      });
      for (let i = 0; i < 20 && bridge.pendingPairings.length === 0; i++) {
        await new Promise((r) => setTimeout(r, 5));
      }
      bridge.resolveNextPairing({ approved: false, error: 'Code mismatch' });
      const res = await callP;
      const body = parseJson(res as never) as Record<string, unknown>;
      expect(body.approved).toBe(false);
      expect('secret' in body).toBe(false);
      // The audit log records the denial.
      const lines = readFileSync(auditLogPath, 'utf8').split('\n').filter(Boolean);
      expect(lines).toHaveLength(1);
      const entry = JSON.parse(lines[0] ?? '') as Record<string, unknown>;
      expect(entry.tool).toBe('request_pairing');
      expect(entry.result).toBe('denied');
    } finally {
      await close();
    }
  });

  it('pairing with MissingHostBridge returns approved:false', async () => {
    const { dbPath, eventsDir } = seedStore(dir, [loginSession()]);
    const { client, close } = await connectClient({ dbPath, eventsDir });
    try {
      const res = await client.callTool({
        name: 'request_pairing',
        arguments: { code: 'ABC-123' },
      });
      const body = parseJson(res as never) as Record<string, unknown>;
      expect(body.approved).toBe(false);
    } finally {
      await close();
    }
  });

  it('bridge.pair throw → audit still written (approved:false), tool returns {approved:false}', async () => {
    // Verify that a bridge.pair rejection does NOT skip the audit-log write.
    // The audit log is the trust surface and must never miss a write.
    const { dbPath, eventsDir } = seedStore(dir, [loginSession()]);
    const auditLogPath = join(dir, 'audit-pairing-throw.log');

    // A bridge where pair() throws unconditionally.
    const throwingBridge: import('../src/mcp/host-bridge.js').HostBridge = {
      async request() {
        throw new Error('not implemented');
      },
      async pair() {
        throw new Error('Transport error: SW context invalidated.');
      },
    };

    const { client, close } = await connectClient({
      dbPath,
      eventsDir,
      hostBridge: throwingBridge as never,
      auditLogPath,
    });
    try {
      const res = await client.callTool({
        name: 'request_pairing',
        arguments: { code: 'ERR-000' },
      });
      const body = parseJson(res as never) as Record<string, unknown>;
      // Tool must return a structured denial, not throw.
      expect(body.approved).toBe(false);
      // The audit entry must have been written despite the bridge throw.
      const lines = readFileSync(auditLogPath, 'utf8').split('\n').filter(Boolean);
      expect(lines).toHaveLength(1);
      const entry = JSON.parse(lines[0] ?? '') as Record<string, unknown>;
      expect(entry.tool).toBe('request_pairing');
      expect(entry.result).toBe('denied');
      // The error message from the bridge must appear in the audit entry.
      expect(lines[0]).toContain('SW context invalidated');
      // CRITICAL: no secret in the log (none was issued).
      expect(lines[0]).not.toContain('secret');
    } finally {
      await close();
    }
  });
});
