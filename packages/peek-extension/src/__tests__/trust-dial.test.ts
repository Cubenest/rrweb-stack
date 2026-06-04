import { describe, expect, it } from 'vitest';
import { dialSegments } from '../../entrypoints/sidepanel/sections/TrustDial';

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
