// Tests for the render_session_journey MCP tool.
//
// Four required scenarios (from the task-1 brief):
//   (a) session with a console error + explicit errorId → CausalChain with
//       non-empty timeline + narrative.
//   (b) errorId omitted → auto-selects the session's latest console error
//       (there may be multiple) and builds the causal chain from it.
//   (c) session with NO console error → a clear text result, no throw.
//   (d) unknown session / no DB → clean error result, no throw.
//
// Approach: connect via InMemoryTransport; use seedStore + a temp db (same
// pattern as server.test.ts + share-session.test.ts).

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { CausalChain } from '../src/mcp/causal-chain.js';
import { createPeekMcpServer } from '../src/mcp/server.js';
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
  dir = mkdtempSync(join(tmpdir(), 'peek-rend-journey-'));
  freshIds();
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

/** Build a session fixture with one console error. */
function sessionWithOneError() {
  const email = el('input', { attributes: { name: 'email' } });
  const submit = el('button', { attributes: { id: 'submit' } });
  const root = documentWith([email, submit]);
  return {
    id: 's_journey',
    createdAt: '2026-07-10T00:00:00.000Z',
    updatedAt: '2026-07-10T00:02:00.000Z',
    url: 'https://app.test/checkout',
    title: 'Checkout flow',
    origin: 'https://app.test',
    events: [
      metaNav('https://app.test/checkout', 1000),
      fullSnapshot(root, 1000),
      inputEvent(email.id, 'user@x.com', 1100),
      clickEvent(submit.id, 1200),
    ],
    consoleErrors: [
      { ts: 1300, message: 'TypeError: cannot read property', stack: 'at checkout()' },
    ],
    networkErrors: [{ ts: 1250, method: 'POST', url: 'https://app.test/api/order', status: 500 }],
  };
}

/** Build a session fixture with TWO console errors (to test latest-selection). */
function sessionWithTwoErrors() {
  freshIds();
  const btn = el('button', { attributes: { id: 'go' } });
  const root = documentWith([btn]);
  return {
    id: 's_two_errors',
    createdAt: '2026-07-10T00:00:00.000Z',
    updatedAt: '2026-07-10T00:02:00.000Z',
    url: 'https://app.test/dash',
    title: 'Dashboard',
    origin: 'https://app.test',
    events: [
      metaNav('https://app.test/dash', 1000),
      fullSnapshot(root, 1000),
      clickEvent(btn.id, 1100),
    ],
    // Two errors — different timestamps; the later one (ts:1500) is the "latest".
    consoleErrors: [
      { ts: 1200, message: 'First error', stack: null },
      { ts: 1500, message: 'Latest error', stack: 'at dash()' },
    ],
    networkErrors: [],
  };
}

/** Build a session fixture with NO console errors. */
function sessionWithNoErrors() {
  freshIds();
  const btn = el('button', { attributes: { id: 'ok' } });
  const root = documentWith([btn]);
  return {
    id: 's_no_errors',
    createdAt: '2026-07-10T00:00:00.000Z',
    updatedAt: '2026-07-10T00:02:00.000Z',
    url: 'https://app.test/clean',
    title: 'Clean page',
    origin: 'https://app.test',
    events: [
      metaNav('https://app.test/clean', 1000),
      fullSnapshot(root, 1000),
      clickEvent(btn.id, 1100),
    ],
    consoleErrors: [],
    networkErrors: [],
  };
}

/** Connect an in-memory client+server pair over the seeded store. */
async function connectClient(opts: {
  dbPath: string;
  eventsDir: string;
}): Promise<{ client: Client; close: () => Promise<void> }> {
  const peek = createPeekMcpServer({ dbPath: opts.dbPath, eventsDir: opts.eventsDir });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'test-journey', version: '0.0.0' });
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

// ---------------------------------------------------------------------------
// Scenario (a): explicit errorId → CausalChain with non-empty timeline + narrative
// ---------------------------------------------------------------------------
describe('render_session_journey: explicit errorId', () => {
  it('returns a CausalChain with a non-empty timeline and narrative', async () => {
    const { dbPath, eventsDir } = seedStore(dir, [sessionWithOneError()]);
    const { client, close } = await connectClient({ dbPath, eventsDir });
    try {
      // Fetch the error id first.
      const errs = parseJson(
        (await client.callTool({
          name: 'get_session_console_errors',
          arguments: { sessionId: 's_journey' },
        })) as never,
      ) as Array<{ id: number }>;
      expect(errs.length).toBeGreaterThan(0);
      const errorId = errs[0]?.id ?? -1;

      const res = await client.callTool({
        name: 'render_session_journey',
        arguments: { sessionId: 's_journey', errorId },
      });
      const chain = parseJson(res as never) as CausalChain;
      expect(chain.errorId).toBe(errorId);
      expect(chain.timeline.length).toBeGreaterThan(0);
      expect(typeof chain.narrative).toBe('string');
      expect(chain.narrative.length).toBeGreaterThan(0);
      // The error entry must appear in the timeline.
      const errorEntry = chain.timeline.find((e) => e.kind === 'error');
      expect(errorEntry).toBeDefined();
      expect(errorEntry?.summary).toContain('TypeError: cannot read property');
    } finally {
      await close();
    }
  });
});

// ---------------------------------------------------------------------------
// Scenario (b): errorId omitted → auto-selects the session's LATEST console error
// ---------------------------------------------------------------------------
describe('render_session_journey: auto-select latest error', () => {
  it('auto-selects the latest error when errorId is omitted', async () => {
    const { dbPath, eventsDir } = seedStore(dir, [sessionWithTwoErrors()]);
    const { client, close } = await connectClient({ dbPath, eventsDir });
    try {
      const res = await client.callTool({
        name: 'render_session_journey',
        arguments: { sessionId: 's_two_errors' },
      });
      const chain = parseJson(res as never) as CausalChain;
      // Should have selected the latest error (ts:1500, 'Latest error').
      expect(chain.error.message).toBe('Latest error');
      expect(chain.timeline.length).toBeGreaterThan(0);
    } finally {
      await close();
    }
  });
});

// ---------------------------------------------------------------------------
// Scenario (c): session with NO console errors → clean text result, no throw
// ---------------------------------------------------------------------------
describe('render_session_journey: no console errors', () => {
  it('returns a clear text result when the session has no console errors', async () => {
    const { dbPath, eventsDir } = seedStore(dir, [sessionWithNoErrors()]);
    const { client, close } = await connectClient({ dbPath, eventsDir });
    try {
      const res = await client.callTool({
        name: 'render_session_journey',
        arguments: { sessionId: 's_no_errors' },
      });
      const text = textOf(res as never);
      // Must be a non-JSON text result explaining there is no error anchor.
      expect(() => JSON.parse(text)).toThrow();
      expect(text.toLowerCase()).toMatch(/no.*error|no.*console/);
    } finally {
      await close();
    }
  });
});

// ---------------------------------------------------------------------------
// Scenario (d): unknown session → clean text result, no throw
// ---------------------------------------------------------------------------
describe('render_session_journey: unknown session / no DB', () => {
  it('returns a not-found message for an unknown sessionId', async () => {
    const { dbPath, eventsDir } = seedStore(dir, [sessionWithOneError()]);
    const { client, close } = await connectClient({ dbPath, eventsDir });
    try {
      const res = await client.callTool({
        name: 'render_session_journey',
        arguments: { sessionId: 's_does_not_exist' },
      });
      const text = textOf(res as never);
      expect(text).toContain('s_does_not_exist');
    } finally {
      await close();
    }
  });

  it('returns the no-DB message when no store exists', async () => {
    const { client, close } = await connectClient({
      dbPath: join(dir, 'does-not-exist.db'),
      eventsDir: join(dir, 'rrweb-events'),
    });
    try {
      const res = await client.callTool({
        name: 'render_session_journey',
        arguments: { sessionId: 's_journey' },
      });
      const text = textOf(res as never);
      expect(text).toContain('No sessions recorded yet');
    } finally {
      await close();
    }
  });
});
