import { describe, expect, it } from 'vitest';
import { indexNodes, selectorFor } from '../src/mcp/selector.js';
import { documentWith, el, freshIds, text } from './fixtures/rrweb.js';

describe('selectorFor memoization', () => {
  it('returns identical selectors with and without a cache, for every node', () => {
    freshIds();
    const root = documentWith([
      el('div', { attributes: { id: 'a' }, children: [el('span', { children: [text('x')] })] }),
      el('button', { children: [text('Go')] }),
    ]);
    const index = indexNodes(root);
    const cache = new Map<number, string | undefined>();
    for (const id of index.keys()) {
      expect(selectorFor(index, id, cache)).toBe(selectorFor(index, id));
    }
    const firstId = [...index.keys()][0] as number;
    expect(cache.has(firstId)).toBe(true);
    expect(selectorFor(index, firstId, cache)).toBe(cache.get(firstId));
  });
});
