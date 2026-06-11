import { EventType } from '@cubenest/rrweb-core';
import type { eventWithTime } from '@cubenest/rrweb-core';
import { describe, expect, it } from 'vitest';
import { type SNode, collectRoots, walk } from '../src/serialized-dom.js';

describe('walk', () => {
  it('yields a node and all nested descendants depth-first', () => {
    const tree: SNode = {
      type: 0,
      childNodes: [
        { type: 2, tagName: 'div', childNodes: [{ type: 2, tagName: 'span', childNodes: [] }] },
        { type: 2, tagName: 'a', childNodes: [] },
      ],
    };
    const tags = [...walk(tree)].map((n) => n.tagName ?? '(doc)');
    expect(tags).toEqual(['(doc)', 'div', 'span', 'a']);
  });
  it('yields nothing for undefined', () => {
    expect([...walk(undefined)]).toEqual([]);
  });
});

describe('collectRoots', () => {
  const full = (node: unknown): eventWithTime =>
    ({ type: EventType.FullSnapshot, timestamp: 0, data: { node } }) as unknown as eventWithTime;
  const incr = (nodes: unknown[]): eventWithTime =>
    ({
      type: EventType.IncrementalSnapshot,
      timestamp: 0,
      data: { adds: nodes.map((n) => ({ node: n })) },
    }) as unknown as eventWithTime;

  it('gathers FullSnapshot roots and IncrementalSnapshot adds', () => {
    const fullRoot = { type: 0, tagName: undefined, childNodes: [] };
    const addA = { type: 2, tagName: 'img', childNodes: [] };
    const addB = { type: 2, tagName: 'script', childNodes: [] };
    const roots = collectRoots([full(fullRoot), incr([addA, addB])]);
    expect(roots).toEqual([fullRoot, addA, addB]);
  });
});
