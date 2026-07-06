// SP3a Task 2 + SP3b Task 3: Tests for elicitation wiring in dispatchActTool.
//
// Tests that execute_action elicits delegated consent from an elicitation-capable
// client BEFORE dispatching to the bridge, and that read ride-alongs opt out.
// SP3b Task 3 additionally verifies that consentDelegated is attached to the
// bridge request iff the human approved (and absent for no-capability clients).
//
// Approach: connect via InMemoryTransport, then shadow getClientCapabilities +
// elicitInput on peek.server.server (the underlying SDK Server instance) so we can
// control the elicitation response without a real elicitation/create round-trip.
// This mirrors the structural-stub pattern in elicitation.test.ts.

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { RegistryBackedHostBridge } from '../src/mcp/host-bridge.js';
import { createPeekMcpServer } from '../src/mcp/server.js';
import { seedStore } from './fixtures/seed.js';

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'peek-mcp-elicit-'));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

/** Parse the first text content block of a tool result as JSON. */
function parseJson(result: { content: Array<{ type: string; text?: string }> }): unknown {
  const block = result.content.find((c) => c.type === 'text');
  return JSON.parse(block?.text ?? 'null');
}

/** Build a connected client+server pair. Returns `peek` so the test can stub
 *  the SDK Server's elicitation methods. */
async function connectClient(opts: {
  hostBridge: RegistryBackedHostBridge;
  auditLogPath?: string;
  dbPath?: string;
  eventsDir?: string;
}): Promise<{
  client: Client;
  peek: ReturnType<typeof createPeekMcpServer>;
  close: () => Promise<void>;
}> {
  const peek = createPeekMcpServer({
    hostBridge: opts.hostBridge,
    ...(opts.auditLogPath !== undefined ? { auditLogPath: opts.auditLogPath } : {}),
    ...(opts.dbPath !== undefined ? { dbPath: opts.dbPath } : {}),
    ...(opts.eventsDir !== undefined ? { eventsDir: opts.eventsDir } : {}),
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

/** Stub the elicitation surface on the SDK Server instance. The underlying
 *  McpServer.server is a `Server`; we shadow its prototype methods on the
 *  instance (via `unknown` to satisfy exactOptionalPropertyTypes) so
 *  elicitConsent() sees the capability and drives the stub. */
function stubElicitation(
  peek: ReturnType<typeof createPeekMcpServer>,
  action: 'accept' | 'decline' | 'cancel',
): void {
  const sdkServer = peek.server.server as unknown as Record<string, unknown>;
  sdkServer.getClientCapabilities = () => ({ elicitation: { form: {} } });
  sdkServer.elicitInput = async () => ({ action });
}

/** Remove the elicitation stubs (set to undefined so elicitConsent falls back
 *  to the real prototype method, which sees no elicitation capability). */
function unstubElicitation(peek: ReturnType<typeof createPeekMcpServer>): void {
  const sdkServer = peek.server.server as unknown as Record<string, unknown>;
  sdkServer.getClientCapabilities = undefined;
  sdkServer.elicitInput = undefined;
}

describe('SP3a: execute_action elicitation (Task 2)', () => {
  it('client advertises + declines → bridge.request NOT called, verdict is deny, audit entry written', async () => {
    const { dbPath, eventsDir } = seedStore(dir, []);
    const auditLogPath = join(dir, 'audit.log');
    const bridge = new RegistryBackedHostBridge();
    const { client, peek, close } = await connectClient({
      hostBridge: bridge,
      auditLogPath,
      dbPath,
      eventsDir,
    });
    try {
      stubElicitation(peek, 'decline');

      const res = await client.callTool({
        name: 'execute_action',
        arguments: { sessionId: 's_any', action: { type: 'click', selector: '#btn' } },
      });

      // Bridge must NOT have been called (short-circuit happened before dispatch).
      expect(bridge.pending).toHaveLength(0);

      const body = parseJson(res as never) as Record<string, unknown>;
      expect(body.verdict).toBe('deny');
      expect(body.result).toBe('denied');
      expect(body.approver).toBe('user');

      // Audit log must have one entry even on deny.
      const { readFileSync } = await import('node:fs');
      const contents = readFileSync(auditLogPath, 'utf8');
      const lines = contents.split('\n').filter((l) => l.length > 0);
      expect(lines).toHaveLength(1);
      const entry = JSON.parse(lines[0] as string) as Record<string, unknown>;
      expect(entry.tool).toBe('execute_action');
      expect(entry.result).toBe('denied');
    } finally {
      await close();
    }
  });

  it('client advertises + accepts → bridge.request IS called (dispatch proceeds)', async () => {
    const { dbPath, eventsDir } = seedStore(dir, []);
    const bridge = new RegistryBackedHostBridge();
    const { client, peek, close } = await connectClient({ hostBridge: bridge, dbPath, eventsDir });
    try {
      stubElicitation(peek, 'accept');

      const callP = client.callTool({
        name: 'execute_action',
        arguments: { sessionId: 's_any', action: { type: 'click', selector: '#btn' } },
      });

      // Poll until the bridge receives the dispatch.
      for (let i = 0; i < 20 && bridge.pending.length === 0; i++) {
        await new Promise((r) => setTimeout(r, 5));
      }
      expect(bridge.pending).toHaveLength(1);
      expect(bridge.pending[0]?.req.tool).toBe('execute_action');

      bridge.resolveNext({ verdict: 'allow', result: 'ok', approver: 'user' });
      const res = await callP;
      const body = parseJson(res as never) as Record<string, unknown>;
      expect(body.verdict).toBe('allow');
      expect(body.result).toBe('ok');
    } finally {
      await close();
    }
  });

  it('client does NOT advertise elicitation → bridge.request IS called (normal SW path)', async () => {
    const { dbPath, eventsDir } = seedStore(dir, []);
    const bridge = new RegistryBackedHostBridge();
    const { client, close } = await connectClient({ hostBridge: bridge, dbPath, eventsDir });
    try {
      // No stubElicitation call — the real getClientCapabilities returns undefined
      // (the in-memory test client doesn't register elicitation capability).
      const callP = client.callTool({
        name: 'execute_action',
        arguments: { sessionId: 's_any', action: { type: 'click', selector: '#btn' } },
      });

      for (let i = 0; i < 20 && bridge.pending.length === 0; i++) {
        await new Promise((r) => setTimeout(r, 5));
      }
      expect(bridge.pending).toHaveLength(1);

      bridge.resolveNext({ verdict: 'allow', result: 'ok', approver: 'level-4-auto' });
      const res = await callP;
      const body = parseJson(res as never) as Record<string, unknown>;
      expect(body.verdict).toBe('allow');
    } finally {
      await close();
    }
  });

  it('attaches consentDelegated on an elicited approval (SP3b)', async () => {
    const { dbPath, eventsDir } = seedStore(dir, []);
    const bridge = new RegistryBackedHostBridge();
    const { client, peek, close } = await connectClient({ hostBridge: bridge, dbPath, eventsDir });
    try {
      stubElicitation(peek, 'accept');

      const callP = client.callTool({
        name: 'execute_action',
        arguments: { sessionId: 's_any', action: { type: 'click', selector: '#btn' } },
      });

      // Poll until the bridge receives the dispatch.
      for (let i = 0; i < 20 && bridge.pending.length === 0; i++) {
        await new Promise((r) => setTimeout(r, 5));
      }
      expect(bridge.pending).toHaveLength(1);

      // The request handed to the bridge must carry consentDelegated: true.
      const captured = bridge.pending[0]?.req;
      expect(captured?.consentDelegated).toBe(true);

      bridge.resolveNext({ verdict: 'allow', result: 'ok', approver: 'user' });
      await callP;
    } finally {
      await close();
    }
  });

  it('does NOT attach consentDelegated when the client has no elicitation capability', async () => {
    const { dbPath, eventsDir } = seedStore(dir, []);
    const bridge = new RegistryBackedHostBridge();
    const { client, close } = await connectClient({ hostBridge: bridge, dbPath, eventsDir });
    try {
      // No stubElicitation call — the real getClientCapabilities returns undefined
      // (the in-memory test client doesn't register elicitation capability).
      const callP = client.callTool({
        name: 'execute_action',
        arguments: { sessionId: 's_any', action: { type: 'click', selector: '#btn' } },
      });

      for (let i = 0; i < 20 && bridge.pending.length === 0; i++) {
        await new Promise((r) => setTimeout(r, 5));
      }
      expect(bridge.pending).toHaveLength(1);

      // consentDelegated must be ABSENT (not just falsy) for no-capability clients.
      const captured = bridge.pending[0]?.req;
      expect('consentDelegated' in (captured ?? {})).toBe(false);

      bridge.resolveNext({ verdict: 'allow', result: 'ok', approver: 'level-4-auto' });
      await callP;
    } finally {
      await close();
    }
  });

  it('still short-circuits (no dispatch) on an elicited decline (SP3b)', async () => {
    const { dbPath, eventsDir } = seedStore(dir, []);
    const bridge = new RegistryBackedHostBridge();
    const { client, peek, close } = await connectClient({ hostBridge: bridge, dbPath, eventsDir });
    try {
      stubElicitation(peek, 'decline');

      // Fire the call and let the short-circuit return a deny response.
      const res = await client.callTool({
        name: 'execute_action',
        arguments: { sessionId: 's_any', action: { type: 'click', selector: '#btn' } },
      });

      // Bridge must never have been called (SP3a short-circuit intact).
      expect(bridge.pending).toHaveLength(0);

      const body = parseJson(res as never) as Record<string, unknown>;
      expect(body.verdict).toBe('deny');
    } finally {
      await close();
    }
  });

  it('get_page_view (read ride-along) does NOT elicit even when the client advertises', async () => {
    const { dbPath, eventsDir } = seedStore(dir, []);
    const bridge = new RegistryBackedHostBridge();
    const { client, peek, close } = await connectClient({ hostBridge: bridge, dbPath, eventsDir });
    try {
      // Client advertises elicitation; if get_page_view incorrectly sets elicit:true
      // the decline stub would short-circuit and no bridge call would happen.
      stubElicitation(peek, 'decline');

      const callP = client.callTool({
        name: 'get_page_view',
        arguments: { sessionId: 's_any' },
      });

      // Bridge must still be called — get_page_view opts out of elicitation.
      for (let i = 0; i < 20 && bridge.pending.length === 0; i++) {
        await new Promise((r) => setTimeout(r, 5));
      }
      expect(bridge.pending).toHaveLength(1);

      bridge.resolveNext({
        verdict: 'allow',
        result: 'ok',
        approver: 'level-1-read',
        details: { view: [] },
      });
      await callP;
    } finally {
      unstubElicitation(peek);
      await close();
    }
  });
});
