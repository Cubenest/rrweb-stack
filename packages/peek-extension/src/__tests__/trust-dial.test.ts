import { describe, expect, it } from 'vitest';
import {
  dialSegments,
  legendEntries,
  needsAutoWarning,
} from '../../entrypoints/sidepanel/sections/TrustDial';

describe('dialSegments — the trust-dial stops', () => {
  it('returns the five levels in escalation order with terse labels', () => {
    expect(dialSegments()).toEqual([
      { level: 0, short: 'Off' },
      { level: 1, short: 'Read' },
      { level: 2, short: 'Suggest' },
      { level: 3, short: 'Confirm' },
      { level: 4, short: 'Auto' },
    ]);
  });
});

describe('needsAutoWarning — gate the Level-4 explicit opt-in', () => {
  it('warns when raising to Level 4 from a lower level', () => {
    expect(needsAutoWarning(1, 4)).toBe(true);
    expect(needsAutoWarning(3, 4)).toBe(true);
  });

  it('does not warn when already at Level 4 (re-selecting)', () => {
    expect(needsAutoWarning(4, 4)).toBe(false);
  });

  it('does not warn for any non-4 target', () => {
    expect(needsAutoWarning(1, 3)).toBe(false);
    expect(needsAutoWarning(4, 1)).toBe(false);
    expect(needsAutoWarning(2, 0)).toBe(false);
  });
});

describe('legendEntries — the full trust ladder for the disclosure', () => {
  it('returns all five levels with a name and behavior, ordered 0..4', () => {
    const entries = legendEntries();
    expect(entries).toHaveLength(5);
    expect(entries.map((e) => e.level)).toEqual([0, 1, 2, 3, 4]);
    for (const e of entries) {
      expect(e.name.length).toBeGreaterThan(0);
      expect(e.behavior.length).toBeGreaterThan(0);
    }
  });
});
