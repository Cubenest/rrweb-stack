import { EventType } from '@cubenest/rrweb-core';
import type { eventWithTime } from '@cubenest/rrweb-core';
import { describe, expect, it } from 'vitest';
import { detectReverseTabnabbing } from '../src/detectors/reverse-tabnabbing.js';

// rrweb serialized element node: type 2 = Element.
function anchor(attributes: Record<string, string>, id = 1) {
  return { type: 2, tagName: 'a', attributes, childNodes: [], id };
}
function fullSnapshot(nodes: unknown[]): eventWithTime {
  return {
    type: EventType.FullSnapshot,
    timestamp: 0,
    data: { node: { type: 0, childNodes: nodes, id: 0 } },
  } as unknown as eventWithTime;
}
function incrementalAdds(nodes: unknown[]): eventWithTime {
  return {
    type: EventType.IncrementalSnapshot,
    timestamp: 0,
    data: { adds: nodes.map((n) => ({ node: n })) },
  } as unknown as eventWithTime;
}

describe('detectReverseTabnabbing', () => {
  it('flags target=_blank without rel=noopener (medium)', () => {
    const f = detectReverseTabnabbing([
      fullSnapshot([anchor({ target: '_blank', href: 'https://x.test' })]),
    ]);
    expect(f).toHaveLength(1);
    expect(f[0]?.severity).toBe('medium');
    expect(f[0]?.signal).toBe('reverse-tabnabbing');
    expect(f[0]?.evidence).toBe('https://x.test');
  });
  it('does not flag when rel contains noopener or noreferrer', () => {
    expect(
      detectReverseTabnabbing([
        fullSnapshot([anchor({ target: '_blank', rel: 'noopener', href: 'https://x' })]),
      ]),
    ).toEqual([]);
    expect(
      detectReverseTabnabbing([
        fullSnapshot([anchor({ target: '_blank', rel: 'nofollow noreferrer' })]),
      ]),
    ).toEqual([]);
  });
  it('does not flag a same-tab link', () => {
    expect(detectReverseTabnabbing([fullSnapshot([anchor({ href: 'https://x.test' })])])).toEqual(
      [],
    );
  });
  it('finds anchors nested deep in the tree', () => {
    const deep = {
      type: 2,
      tagName: 'div',
      attributes: {},
      id: 9,
      childNodes: [anchor({ target: '_blank', href: 'https://deep' })],
    };
    expect(detectReverseTabnabbing([fullSnapshot([deep])])).toHaveLength(1);
  });
  it('finds anchors added via incremental mutation', () => {
    expect(
      detectReverseTabnabbing([
        incrementalAdds([anchor({ target: '_blank', href: 'https://added' })]),
      ]),
    ).toHaveLength(1);
  });
  it('dedupes the same href', () => {
    const a = anchor({ target: '_blank', href: 'https://dup' });
    expect(detectReverseTabnabbing([fullSnapshot([a, a])])).toHaveLength(1);
  });
  it('uses (no href) evidence when href is absent', () => {
    expect(
      detectReverseTabnabbing([fullSnapshot([anchor({ target: '_blank' })])])[0]?.evidence,
    ).toBe('(no href)');
  });
  it('is case-insensitive on target and rel', () => {
    expect(
      detectReverseTabnabbing([fullSnapshot([anchor({ target: '_BLANK', href: 'https://up' })])]),
    ).toHaveLength(1);
    expect(
      detectReverseTabnabbing([
        fullSnapshot([anchor({ target: '_BLANK', rel: 'NOOPENER', href: 'https://up2' })]),
      ]),
    ).toEqual([]);
  });
  it('flags two distinct hrefs (dedup is per-href, not global)', () => {
    const f = detectReverseTabnabbing([
      fullSnapshot([
        anchor({ target: '_blank', href: 'https://a' }),
        anchor({ target: '_blank', href: 'https://b' }),
      ]),
    ]);
    expect(f).toHaveLength(2);
  });
});
