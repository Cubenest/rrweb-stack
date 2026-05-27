import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PEEK_MCP_TOOLS, createPeekMcpServer } from '../src/mcp/server.js';
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
}): Promise<{ client: Client; close: () => Promise<void> }> {
  const peek = createPeekMcpServer({
    ...(opts.dbPath !== undefined ? { dbPath: opts.dbPath } : {}),
    ...(opts.eventsDir !== undefined ? { eventsDir: opts.eventsDir } : {}),
  });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'test-client', version: '0.0.0' });
  if (opts.withRoots) client.registerCapabilities({ roots: {} });

  await Promise.all([peek.server.connect(serverTransport), client.connect(clientTransport)]);
  return {
    client,
    close: async () => {
      await client.close();
      peek.close();
    },
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
  it('lists exactly the 8 read-only tools', async () => {
    const { dbPath, eventsDir } = seedStore(dir, [loginSession()]);
    const { client, close } = await connectClient({ dbPath, eventsDir });
    try {
      const { tools } = await client.listTools();
      const names = tools.map((t) => t.name).sort();
      expect(names).toEqual([...PEEK_MCP_TOOLS].sort());
      // No write tools leaked in.
      expect(names).not.toContain('execute_action');
      expect(names).not.toContain('request_authorization');
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
      // tools/list still works.
      const { tools } = await client.listTools();
      expect(tools).toHaveLength(8);
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
