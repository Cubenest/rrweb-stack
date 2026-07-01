import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createPeekMcpServer } from '../src/mcp/server.js';
import { GENESIS_PREV, hashLine } from '../src/native-host/audit-chain.js';
import type { AuditHead } from '../src/native-host/audit-head.js';

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'peek-mcp-verify-'));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

/** Build a 2-entry chained log buffer + matching head. */
function twoEntryChain(): { logBuf: Buffer; head: AuditHead } {
  const line1 = JSON.stringify({
    ts: '2026-07-01T00:00:00.000Z',
    tool: 'execute_action',
    seq: 1,
    prevHash: GENESIS_PREV,
  });
  const line2 = JSON.stringify({
    ts: '2026-07-01T00:00:01.000Z',
    tool: 'execute_action',
    seq: 2,
    prevHash: hashLine(line1),
  });
  const logText = `${line1}\n${line2}\n`;
  const logBuf = Buffer.from(logText, 'utf8');
  const head: AuditHead = {
    version: 1,
    prefix: null,
    seq: 2,
    headHash: hashLine(line2),
    gapCount: 0,
    bytes: logBuf.length,
  };
  return { logBuf, head };
}

/** Connect an in-memory client to a freshly-built server with the given auditLogPath. */
async function connectClient(auditLogPath?: string): Promise<{
  client: Client;
  close: () => Promise<void>;
}> {
  const peek = createPeekMcpServer({ auditLogPath });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'test-client', version: '0.0.0' });
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

describe('verify_audit_log tool', () => {
  it('returns { logPresent: false } with a "no audit log" summary when the file is absent', async () => {
    // Point the server at a path that does not exist.
    const missingPath = join(dir, 'audit.log');
    const { client, close } = await connectClient(missingPath);
    try {
      const res = await client.callTool({ name: 'verify_audit_log', arguments: {} });
      const body = parseJson(res as never) as Record<string, unknown>;
      expect(body.logPresent).toBe(false);
      expect(typeof body.summary).toBe('string');
      expect((body.summary as string).toLowerCase()).toMatch(/no audit log/i);
    } finally {
      await close();
    }
  });

  it('returns status "intact" for a healthy 2-entry chain', async () => {
    const { logBuf, head } = twoEntryChain();
    const logPath = join(dir, 'audit.log');
    const headPath = join(dir, 'audit.head.json');
    writeFileSync(logPath, logBuf);
    writeFileSync(headPath, JSON.stringify(head));

    const { client, close } = await connectClient(logPath);
    try {
      const res = await client.callTool({ name: 'verify_audit_log', arguments: {} });
      const body = parseJson(res as never) as Record<string, unknown>;
      expect(body.logPresent).toBe(true);
      expect(body.status).toBe('intact');
      expect(body.entriesVerified).toBe(2);
    } finally {
      await close();
    }
  });

  it('returns status "broken" when a middle line body is edited', async () => {
    const { logBuf, head } = twoEntryChain();
    const logPath = join(dir, 'audit.log');
    const headPath = join(dir, 'audit.head.json');

    // Tamper: replace the first line with a modified body.
    const originalLines = logBuf.toString('utf8').split('\n');
    // Parse and mutate line 0 (first entry).
    const parsed = JSON.parse(originalLines[0] as string) as Record<string, unknown>;
    parsed.tool = 'tampered_tool';
    originalLines[0] = JSON.stringify(parsed);
    const tamperedBuf = Buffer.from(originalLines.join('\n'), 'utf8');

    writeFileSync(logPath, tamperedBuf);
    writeFileSync(headPath, JSON.stringify(head));

    const { client, close } = await connectClient(logPath);
    try {
      const res = await client.callTool({ name: 'verify_audit_log', arguments: {} });
      const body = parseJson(res as never) as Record<string, unknown>;
      expect(body.logPresent).toBe(true);
      expect(body.status).toBe('broken');
    } finally {
      await close();
    }
  });
});
