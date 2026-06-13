import { EventEmitter } from 'node:events';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
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
  it('lists exactly the documented tool surface (8 read + 2 write + 2 suggest)', async () => {
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
      expect(script).toContain("await page.fill('input[name=\"email\"]', 'me@x.com');");
      expect(script).toContain("await page.click('#login');");
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
      // tools/list still works (8 read + 2 write + 2 suggest).
      const { tools } = await client.listTools();
      expect(tools).toHaveLength(12);
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
          action: { type: 'click' }, // missing selector → invalid
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
