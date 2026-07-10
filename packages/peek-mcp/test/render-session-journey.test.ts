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

/**
 * Build a session fixture with MANY (>200) error-level console events with
 * strictly increasing ts. The very last one (highest ts) is the true "latest".
 * Regression fixture for the auto-select bug: an ASC LIMIT 200 query would miss
 * the real latest error in a session with more than 200 errors.
 */
function sessionWithManyErrors(count: number) {
  freshIds();
  const btn = el('button', { attributes: { id: 'many' } });
  const root = documentWith([btn]);
  const consoleErrors = Array.from({ length: count }, (_, i) => ({
    ts: 2000 + i, // strictly increasing; the last (i === count-1) has the highest ts
    message: `error #${i}`,
    stack: null,
  }));
  return {
    id: 's_many_errors',
    createdAt: '2026-07-10T00:00:00.000Z',
    updatedAt: '2026-07-10T00:02:00.000Z',
    url: 'https://app.test/many',
    title: 'Many errors',
    origin: 'https://app.test',
    events: [
      metaNav('https://app.test/many', 1000),
      fullSnapshot(root, 1000),
      clickEvent(btn.id, 1100),
    ],
    consoleErrors,
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

  it('auto-selects the true latest error even when a session has >200 console errors', async () => {
    // Regression for the ASC-LIMIT-200 bug: with 205 errors, the old auto-select
    // read the 200 OLDEST (ORDER BY ts ASC LIMIT 200) and took the 200th, missing
    // the real latest. The dedicated getLatestConsoleError query fixes this.
    const COUNT = 205;
    const { dbPath, eventsDir } = seedStore(dir, [sessionWithManyErrors(COUNT)]);
    const { client, close } = await connectClient({ dbPath, eventsDir });
    try {
      // The true latest error id: seed inserts in order, ids are 1..COUNT.
      const errs = parseJson(
        (await client.callTool({
          name: 'get_session_console_errors',
          arguments: { sessionId: 's_many_errors', limit: 200, since: 2000 + (COUNT - 1) },
        })) as never,
      ) as Array<{ id: number; message: string }>;
      // Only the single latest error has ts === 2000 + COUNT-1.
      expect(errs).toHaveLength(1);
      const latestId = errs[0]?.id ?? -1;
      const latestMessage = errs[0]?.message ?? '';
      expect(latestMessage).toBe(`error #${COUNT - 1}`);

      // Auto-select (no errorId): must pick the true latest, NOT the 200th oldest.
      const res = await client.callTool({
        name: 'render_session_journey',
        arguments: { sessionId: 's_many_errors' },
      });
      const chain = parseJson(res as never) as CausalChain;
      expect(chain.errorId).toBe(latestId);
      expect(chain.error.message).toBe(`error #${COUNT - 1}`);
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
      // peek-mcp has NO session-existence concept: an unknown sessionId and an
      // existing-but-empty session both flow through the auto-select branch and
      // return the SAME "no console errors" message. Assert the specific message
      // (not just the id echo), and that it is plain text, not a CausalChain JSON.
      expect(text).toContain('s_does_not_exist');
      expect(text).toContain('has no console errors to anchor a journey');
      expect(() => JSON.parse(text)).toThrow();
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
