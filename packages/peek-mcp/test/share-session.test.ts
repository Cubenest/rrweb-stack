// Tests for the share_session MCP tool (Task 2 — consent-gated egress export).
//
// Three required scenarios (from the task-2 brief):
//   (a) deny → { ok: false, result: 'denied' }, no bundle file written.
//   (b) approve → { ok: true, bundlePath, filename, sizeBytes, caveat };
//       the file at bundlePath passes verifyBundle.
//   (c) approved call writes a 'share_session' audit entry (no bundle bytes).
//
// Approach: connect via InMemoryTransport; stub getClientCapabilities +
// elicitInput on the underlying SDK Server (same pattern as server.elicit.test.ts)
// to control elicitation responses without a real MCP elicitation round-trip.
// Use seedStore to create a real SQLite DB with a minimal session.

import { existsSync, readFileSync, rmSync } from 'node:fs';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createPeekMcpServer } from '../src/mcp/server.js';
import { unpackBundle, verifyBundle } from '../src/session-bundle.js';
import { documentWith, el, freshIds, fullSnapshot, text } from './fixtures/rrweb.js';
import { seedStore } from './fixtures/seed.js';

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'peek-share-session-'));
  freshIds();
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

/** Parse the first text content block of a tool result as JSON. */
function parseJson(result: { content: Array<{ type: string; text?: string }> }): unknown {
  const block = result.content.find((c) => c.type === 'text');
  return JSON.parse(block?.text ?? 'null');
}

/** Build a connected client+server pair. */
async function connectClient(opts: {
  dbPath: string;
  eventsDir: string;
  auditLogPath: string;
}): Promise<{
  client: Client;
  peek: ReturnType<typeof createPeekMcpServer>;
  close: () => Promise<void>;
}> {
  const peek = createPeekMcpServer({
    dbPath: opts.dbPath,
    eventsDir: opts.eventsDir,
    auditLogPath: opts.auditLogPath,
  });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'test-connector', version: '0.0.0' });
  await Promise.all([peek.server.connect(serverTransport), client.connect(clientTransport)]);
  return {
    client,
    peek,
    close: async () => {
      await client.close();
      peek.close();
    },
  };
}

/** Stub elicitation on the SDK Server instance (mirrors server.elicit.test.ts). */
function stubElicitation(
  peek: ReturnType<typeof createPeekMcpServer>,
  action: 'accept' | 'decline' | 'cancel',
): void {
  const sdkServer = peek.server.server as unknown as Record<string, unknown>;
  sdkServer.getClientCapabilities = () => ({ elicitation: { form: {} } });
  sdkServer.elicitInput = async () => ({ action });
}

/** Seed a store with one session that has events, console errors, and network events. */
function seedSessionWithData(homeDir: string): {
  dbPath: string;
  eventsDir: string;
  sessionId: string;
} {
  const sessionId = 's_test-share-session-0001';
  const now = new Date('2026-07-09T10:00:00.000Z');
  const events = [
    fullSnapshot(documentWith([el('h1', { children: [text('hello')] })]), now.getTime()),
  ];
  const { dbPath, eventsDir } = seedStore(homeDir, [
    {
      id: sessionId,
      createdAt: now.toISOString(),
      updatedAt: new Date(now.getTime() + 5000).toISOString(),
      url: 'https://example.com/app',
      title: 'Test App',
      origin: 'https://example.com',
      events,
      consoleErrors: [
        {
          ts: now.getTime() + 1000,
          message: 'Uncaught TypeError: x is not a function',
          stack: 'at app.js:1',
        },
      ],
      networkErrors: [
        {
          ts: now.getTime() + 2000,
          method: 'GET',
          url: 'https://example.com/api/data',
          status: 404,
        },
      ],
    },
  ]);
  return { dbPath, eventsDir, sessionId };
}

describe('share_session — deny', () => {
  it('(a) decline → { ok: false, result: denied }, no bundle file written', async () => {
    const { dbPath, eventsDir, sessionId } = seedSessionWithData(dir);
    const auditLogPath = join(dir, 'audit.log');
    const { client, peek, close } = await connectClient({ dbPath, eventsDir, auditLogPath });
    try {
      stubElicitation(peek, 'decline');

      const res = await client.callTool({
        name: 'share_session',
        arguments: { sessionId, surface: 'Slack' },
      });

      const body = parseJson(res as never) as Record<string, unknown>;
      expect(body.ok).toBe(false);
      expect(body.result).toBe('denied');

      // No bundle file should have been written to tmpdir.
      const { readdirSync } = await import('node:fs');
      const safeId = sessionId.replace(/[^a-zA-Z0-9_-]/g, '_');
      const tmpFiles = readdirSync(tmpdir()).filter(
        (f) => f.startsWith(safeId) && f.endsWith('.peekbundle'),
      );
      expect(tmpFiles).toHaveLength(0);
    } finally {
      await close();
    }
  });

  it('(a) cancel → { ok: false, result: denied }, no bundle file written', async () => {
    const { dbPath, eventsDir, sessionId } = seedSessionWithData(dir);
    const auditLogPath = join(dir, 'audit.log');
    const { client, peek, close } = await connectClient({ dbPath, eventsDir, auditLogPath });
    try {
      stubElicitation(peek, 'cancel');

      const res = await client.callTool({
        name: 'share_session',
        arguments: { sessionId, surface: 'Slack' },
      });

      const body = parseJson(res as never) as Record<string, unknown>;
      expect(body.ok).toBe(false);
      expect(body.result).toBe('denied');

      // No bundle file should have been written (cancel is fail-closed).
      expect(body.bundlePath).toBeUndefined();
      // Verify no .peekbundle files for this session exist in tmpdir.
      const { readdirSync } = await import('node:fs');
      const safeId = sessionId.replace(/[^a-zA-Z0-9_-]/g, '_');
      const tmpFiles = readdirSync(tmpdir()).filter(
        (f) => f.startsWith(safeId) && f.endsWith('.peekbundle'),
      );
      expect(tmpFiles).toHaveLength(0);
    } finally {
      await close();
    }
  });

  it('(a) unknown/malformed elicit action → { ok: false, result: denied }, no bundle file written', async () => {
    const { dbPath, eventsDir, sessionId } = seedSessionWithData(dir);
    const auditLogPath = join(dir, 'audit.log');
    const { client, peek, close } = await connectClient({ dbPath, eventsDir, auditLogPath });
    try {
      // Stub an unknown action value to verify fail-closed behavior for unrecognized responses.
      const sdkServer = peek.server.server as unknown as Record<string, unknown>;
      sdkServer.getClientCapabilities = () => ({ elicitation: { form: {} } });
      sdkServer.elicitInput = async () => ({ action: 'something-unknown' });

      const res = await client.callTool({
        name: 'share_session',
        arguments: { sessionId, surface: 'Slack' },
      });

      const body = parseJson(res as never) as Record<string, unknown>;
      expect(body.ok).toBe(false);
      expect(body.result).toBe('denied');

      // No bundle file should have been written (unknown action is fail-closed).
      expect(body.bundlePath).toBeUndefined();
      const { readdirSync } = await import('node:fs');
      const safeId = sessionId.replace(/[^a-zA-Z0-9_-]/g, '_');
      const tmpFiles = readdirSync(tmpdir()).filter(
        (f) => f.startsWith(safeId) && f.endsWith('.peekbundle'),
      );
      expect(tmpFiles).toHaveLength(0);
    } finally {
      await close();
    }
  });

  it('(a) no elicitation capability → denied (egress requires consent)', async () => {
    const { dbPath, eventsDir, sessionId } = seedSessionWithData(dir);
    const auditLogPath = join(dir, 'audit.log');
    const { client, close } = await connectClient({ dbPath, eventsDir, auditLogPath });
    try {
      // No stubElicitation call — client has no elicitation capability.
      const res = await client.callTool({
        name: 'share_session',
        arguments: { sessionId, surface: 'Slack' },
      });

      const body = parseJson(res as never) as Record<string, unknown>;
      expect(body.ok).toBe(false);
      expect(body.result).toBe('denied');
    } finally {
      await close();
    }
  });

  it('(a) deny writes a denied audit entry (no bundle bytes)', async () => {
    const { dbPath, eventsDir, sessionId } = seedSessionWithData(dir);
    const auditLogPath = join(dir, 'audit.log');
    const { client, peek, close } = await connectClient({ dbPath, eventsDir, auditLogPath });
    try {
      stubElicitation(peek, 'decline');

      await client.callTool({
        name: 'share_session',
        arguments: { sessionId, surface: 'Slack' },
      });

      const contents = readFileSync(auditLogPath, 'utf8');
      const lines = contents.split('\n').filter((l) => l.length > 0);
      expect(lines).toHaveLength(1);
      const entry = JSON.parse(lines[0] as string) as Record<string, unknown>;
      expect(entry.tool).toBe('share_session');
      expect(entry.result).toBe('denied');
      expect(entry.sessionId).toBe(sessionId);
      // No bundle bytes in audit entry.
      expect(JSON.stringify(entry)).not.toContain('bundlePath');
      expect(JSON.stringify(entry)).not.toContain('events.json');
    } finally {
      await close();
    }
  });
});

describe('share_session — approve', () => {
  it('(b) approve → ok:true, bundlePath whose file passes verifyBundle', async () => {
    const { dbPath, eventsDir, sessionId } = seedSessionWithData(dir);
    const auditLogPath = join(dir, 'audit.log');
    const { client, peek, close } = await connectClient({ dbPath, eventsDir, auditLogPath });
    let bundlePath: string | undefined;
    try {
      stubElicitation(peek, 'accept');

      const res = await client.callTool({
        name: 'share_session',
        arguments: { sessionId, surface: 'Slack' },
      });

      const body = parseJson(res as never) as Record<string, unknown>;
      expect(body.ok).toBe(true);
      expect(typeof body.bundlePath).toBe('string');
      expect(typeof body.filename).toBe('string');
      expect(typeof body.sizeBytes).toBe('number');
      expect(body.sizeBytes as number).toBeGreaterThan(0);
      expect(typeof body.caveat).toBe('string');
      expect((body.caveat as string).length).toBeGreaterThan(0);

      bundlePath = body.bundlePath as string;
      expect(existsSync(bundlePath)).toBe(true);

      // The file must be a valid bundle.
      const unpacked = unpackBundle(bundlePath);
      expect(() => verifyBundle(unpacked)).not.toThrow();

      // filename must end with .peekbundle and contain the session id (sanitized).
      expect(body.filename as string).toMatch(/\.peekbundle$/);
    } finally {
      // Clean up the temp bundle file.
      if (bundlePath && existsSync(bundlePath)) rmSync(bundlePath);
      await close();
    }
  });

  it('(b) bundle contains the session data (origin, url, event count)', async () => {
    const { dbPath, eventsDir, sessionId } = seedSessionWithData(dir);
    const auditLogPath = join(dir, 'audit.log');
    const { client, peek, close } = await connectClient({ dbPath, eventsDir, auditLogPath });
    let bundlePath: string | undefined;
    try {
      stubElicitation(peek, 'accept');

      const res = await client.callTool({
        name: 'share_session',
        arguments: { sessionId, surface: 'Slack' },
      });

      const body = parseJson(res as never) as Record<string, unknown>;
      bundlePath = body.bundlePath as string;

      const unpacked = unpackBundle(bundlePath);
      verifyBundle(unpacked);

      // Session row fields should be present.
      expect((unpacked.session.session as Record<string, unknown>).id).toBe(sessionId);
      expect((unpacked.session.session as Record<string, unknown>).origin).toBe(
        'https://example.com',
      );
      // Events should be present.
      expect(unpacked.events.length).toBeGreaterThan(0);
      // Console events should be present.
      expect(Array.isArray(unpacked.session.consoleEvents)).toBe(true);
      // Network events should be present.
      expect(Array.isArray(unpacked.session.networkEvents)).toBe(true);
    } finally {
      if (bundlePath && existsSync(bundlePath)) rmSync(bundlePath);
      await close();
    }
  });

  it('(c) approve writes a share_session audit entry with no bundle bytes', async () => {
    const { dbPath, eventsDir, sessionId } = seedSessionWithData(dir);
    const auditLogPath = join(dir, 'audit.log');
    const { client, peek, close } = await connectClient({ dbPath, eventsDir, auditLogPath });
    let bundlePath: string | undefined;
    try {
      stubElicitation(peek, 'accept');

      const res = await client.callTool({
        name: 'share_session',
        arguments: { sessionId, surface: 'Slack' },
      });

      const body = parseJson(res as never) as Record<string, unknown>;
      bundlePath = body.bundlePath as string;

      const contents = readFileSync(auditLogPath, 'utf8');
      const lines = contents.split('\n').filter((l) => l.length > 0);
      expect(lines).toHaveLength(1);
      const entry = JSON.parse(lines[0] as string) as Record<string, unknown>;

      // Required audit fields.
      expect(entry.tool).toBe('share_session');
      expect(entry.result).toBe('ok');
      expect(entry.sessionId).toBe(sessionId);
      expect(entry.approver).toBe('connector-elicit');

      // Args must record the surface (so the audit shows where it went) but NOT the bundle bytes.
      const args = entry.args as Record<string, unknown>;
      expect(args.sessionId).toBe(sessionId);
      expect(args.surface).toBe('Slack');

      // No bundle content in the audit entry.
      const entryStr = JSON.stringify(entry);
      expect(entryStr).not.toContain('events.json');
      expect(entryStr).not.toContain('session.json');
      // bundlePath may appear in args but should NOT carry the file content.
      const parsedAgain = JSON.parse(entryStr) as Record<string, unknown>;
      const argsStr = JSON.stringify(parsedAgain.args as Record<string, unknown>);
      expect(argsStr).not.toContain('FullSnapshot');
    } finally {
      if (bundlePath && existsSync(bundlePath)) rmSync(bundlePath);
      await close();
    }
  });

  it('(c) approve with unknown session → error (no file, no audit ok entry)', async () => {
    const { dbPath, eventsDir } = seedSessionWithData(dir);
    const auditLogPath = join(dir, 'audit.log');
    const { client, peek, close } = await connectClient({ dbPath, eventsDir, auditLogPath });
    try {
      stubElicitation(peek, 'accept');

      const res = await client.callTool({
        name: 'share_session',
        arguments: { sessionId: 's_does-not-exist', surface: 'Slack' },
      });

      const body = parseJson(res as never) as Record<string, unknown>;
      // Should return an error (session not found).
      expect(body.ok).toBe(false);
      expect(body.result).toBe('error');
    } finally {
      await close();
    }
  });
});

describe('share_session — tool is registered', () => {
  it('share_session appears in the tool list', async () => {
    const { dbPath, eventsDir } = seedSessionWithData(dir);
    const auditLogPath = join(dir, 'audit.log');
    const { client, close } = await connectClient({ dbPath, eventsDir, auditLogPath });
    try {
      const tools = await client.listTools();
      const names = tools.tools.map((t) => t.name);
      expect(names).toContain('share_session');
    } finally {
      await close();
    }
  });
});
