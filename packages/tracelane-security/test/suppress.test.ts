import { describe, expect, it } from 'vitest';
import type { SecurityFinding } from '../src/index.js';
import { applySuppressions } from '../src/suppress.js';

const f = (signal: SecurityFinding['signal'], evidence: string): SecurityFinding => ({
  id: `${signal}:${evidence}`,
  signal,
  severity: 'low',
  title: '',
  detail: '',
  evidence,
  advisory: true,
});

describe('applySuppressions', () => {
  it('returns all findings when no rules', () => {
    const all = [f('mixed-content', 'http://x')];
    expect(applySuppressions(all, [])).toEqual(all);
  });
  it('drops by signal', () => {
    expect(
      applySuppressions(
        [f('mixed-content', 'http://x'), f('insecure-cookie', 'a:Secure')],
        [{ signal: 'mixed-content' }],
      ),
    ).toHaveLength(1);
  });
  it('drops by evidence', () => {
    expect(applySuppressions([f('mixed-content', 'http://x')], [{ evidence: 'http://x' }])).toEqual(
      [],
    );
  });
  it('a rule with both signal and evidence must match both', () => {
    expect(
      applySuppressions(
        [f('mixed-content', 'http://x')],
        [{ signal: 'insecure-cookie', evidence: 'http://x' }],
      ),
    ).toHaveLength(1);
    expect(
      applySuppressions(
        [f('mixed-content', 'http://x')],
        [{ signal: 'mixed-content', evidence: 'http://x' }],
      ),
    ).toEqual([]);
  });
  it('an empty rule object matches nothing (no-op)', () => {
    const all = [f('mixed-content', 'http://x')];
    expect(applySuppressions(all, [{}])).toEqual(all);
  });
});
