import { describe, expect, it } from 'vitest';
import { buildCausalChain } from '../src/mcp/causal-chain.js';
import type { DomChange, UserAction } from '../src/mcp/event-walker.js';
import type { ConsoleErrorRow, NetworkErrorRow } from '../src/mcp/queries.js';

const error: ConsoleErrorRow = {
  id: 42,
  ts: 5000,
  level: 'error',
  message: 'TypeError: x is undefined',
  stack: null,
};
const action: UserAction = {
  type: 'click',
  ts: 4800,
  selector: '#submit',
  summary: 'click #submit',
};
const net: NetworkErrorRow = {
  id: 1,
  ts: 4850,
  method: 'POST',
  url: '/api/login',
  status: 500,
  statusText: 'Internal Server Error',
  resourceType: 'fetch',
  durationMs: 30,
  errorText: null,
};
const dom: DomChange = {
  ts: 4900,
  op: 'attribute',
  attribute: 'class',
  value: 'error',
  target: '#status',
};

describe('buildCausalChain', () => {
  it('assembles a ts-ordered timeline with grouped arrays and refs', () => {
    const chain = buildCausalChain({
      error,
      windowMs: 5000,
      actions: [action],
      domMutations: [dom],
      networkErrors: [net],
    });
    expect(chain.errorId).toBe(42);
    expect(chain.errorTs).toBe(5000);
    expect(chain.windowMs).toBe(5000);
    expect(chain.actions).toEqual([action]);
    expect(chain.networkErrors).toEqual([net]);
    expect(chain.domMutations).toEqual([dom]);
    expect(chain.timeline.map((t) => [t.kind, t.relMs])).toEqual([
      ['action', -200],
      ['network', -150],
      ['dom', -100],
      ['error', 0],
    ]);
    expect(chain.timeline[0]).toMatchObject({ kind: 'action', ref: 0 });
    expect(chain.timeline[3]).toMatchObject({ kind: 'error' });
    expect(chain.timeline[3].ref).toBeUndefined();
    expect(chain.truncated).toEqual({});
  });

  it('caps domMutations to 50 and networkErrors to 20, keeping the most recent, flagging truncated', () => {
    const doms: DomChange[] = Array.from({ length: 55 }, (_, i) => ({
      ts: 4000 + i,
      op: 'attribute',
      attribute: 'a',
      value: String(i),
      target: '#x',
    }));
    const nets: NetworkErrorRow[] = Array.from({ length: 25 }, (_, i) => ({
      ...net,
      id: i,
      ts: 4000 + i,
    }));
    const chain = buildCausalChain({
      error,
      windowMs: 5000,
      actions: [],
      domMutations: doms,
      networkErrors: nets,
    });
    expect(chain.domMutations).toHaveLength(50);
    expect(chain.domMutations[49]?.value).toBe('54');
    expect(chain.networkErrors).toHaveLength(20);
    expect(chain.truncated).toEqual({ domMutations: true, networkErrors: true });
  });

  it('emits a deterministic narrative for a populated window', () => {
    const chain = buildCausalChain({
      error,
      windowMs: 5000,
      actions: [action],
      domMutations: [dom],
      networkErrors: [net],
    });
    expect(chain.narrative).toBe(
      'In the 5000ms before console error #42 (error: "TypeError: x is undefined"): 1 user action(s), 1 network error(s), 1 DOM mutation(s). Last action: click #submit (200ms before). Network error: POST /api/login → 500 (150ms before).',
    );
  });

  it('narrative highlights the network error closest to the console error', () => {
    const earlier = { ...net, id: 2, url: '/early', ts: 1000 }; // -4000ms (oldest)
    const closer = { ...net, id: 3, url: '/api/login', ts: 4850 }; // -150ms (closest)
    const chain = buildCausalChain({
      error,
      windowMs: 5000,
      actions: [],
      domMutations: [],
      networkErrors: [earlier, closer],
    });
    expect(chain.narrative).toContain('Network error: POST /api/login → 500 (150ms before)');
    expect(chain.narrative).not.toContain('/early');
  });

  it('emits a deterministic narrative for an empty window', () => {
    const chain = buildCausalChain({
      error,
      windowMs: 5000,
      actions: [],
      domMutations: [],
      networkErrors: [],
    });
    expect(chain.timeline.map((t) => t.kind)).toEqual(['error']);
    expect(chain.narrative).toBe(
      'No user actions, network errors, or DOM mutations in the 5000ms before console error #42 (error: "TypeError: x is undefined").',
    );
  });
});
