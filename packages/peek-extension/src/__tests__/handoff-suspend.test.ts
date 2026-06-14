import { describe, expect, it } from 'vitest';
import { shouldDropRrwebDuringHandoff } from '../relay/handoff-suspend';

/**
 * Pure-helper assertion for the §12-12c invariant: during a handoff the relay
 * DROPS rrweb events at production time (so they're never buffered then flushed
 * after the phase flips back to `up` — the post-resume leak), but console-plugin
 * events ride a separate masked channel and stay unconditional.
 */
describe('shouldDropRrwebDuringHandoff', () => {
  it('in-handoff + non-console rrweb event → drop (true)', () => {
    expect(shouldDropRrwebDuringHandoff(true, false)).toBe(true);
  });

  it('in-handoff + console event → keep (false)', () => {
    expect(shouldDropRrwebDuringHandoff(true, true)).toBe(false);
  });

  it('not-in-handoff + non-console rrweb event → keep (false)', () => {
    expect(shouldDropRrwebDuringHandoff(false, false)).toBe(false);
  });

  it('not-in-handoff + console event → keep (false)', () => {
    expect(shouldDropRrwebDuringHandoff(false, true)).toBe(false);
  });
});
