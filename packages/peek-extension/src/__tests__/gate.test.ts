import { describe, expect, it } from 'vitest';
import { gate } from '../permissions/gate';

describe('gate — the ADR-0010 §B.4 decision table', () => {
  it('Level 0 (Off) → deny, regardless of destructive', () => {
    expect(gate({ level: 0, destructive: false })).toMatchObject({
      verdict: 'deny',
      reason: 'level-0-off',
    });
    expect(gate({ level: 0, destructive: true })).toMatchObject({ verdict: 'deny' });
  });

  it('Level 1 (Read-only, DEFAULT) → deny', () => {
    expect(gate({ level: 1, destructive: false }).verdict).toBe('deny');
    expect(gate({ level: 1, destructive: true }).verdict).toBe('deny');
  });

  it('Level 2 (Suggest-only) → deny (overlay is a separate path)', () => {
    expect(gate({ level: 2, destructive: false }).verdict).toBe('deny');
    expect(gate({ level: 2, destructive: true }).verdict).toBe('deny');
  });

  it('Level 3 (Act-with-confirm) → confirm, always', () => {
    expect(gate({ level: 3, destructive: false })).toMatchObject({
      verdict: 'confirm',
      reason: 'level-3-act-with-confirm',
    });
    expect(gate({ level: 3, destructive: true }).verdict).toBe('confirm');
  });

  it('Level 4 (YOLO) non-destructive → allow', () => {
    expect(gate({ level: 4, destructive: false })).toMatchObject({
      verdict: 'allow',
      reason: 'level-4-yolo',
    });
  });

  it('Level 4 (YOLO) + destructive → confirm (override beats YOLO)', () => {
    expect(gate({ level: 4, destructive: true })).toMatchObject({
      verdict: 'confirm',
      reason: 'level-4-destructive-override',
    });
  });

  it('every reason string is a stable, single-token-ish identifier', () => {
    // The audit-log writer + diagnostics depend on these being stable; this
    // pins the contract so a refactor that renames them breaks the test.
    const verdicts = (
      [
        [0, false],
        [1, false],
        [2, false],
        [3, false],
        [4, false],
        [4, true],
      ] as const
    ).map(([level, destructive]) => gate({ level, destructive }).reason);
    expect(verdicts).toEqual([
      'level-0-off',
      'level-1-read-only',
      'level-2-suggest-only',
      'level-3-act-with-confirm',
      'level-4-yolo',
      'level-4-destructive-override',
    ]);
  });
});
