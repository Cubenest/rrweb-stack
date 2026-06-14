import { describe, expect, it } from 'vitest';
import { nextHandoffFlag, shouldDropRrwebDuringHandoff } from '../relay/handoff-suspend';

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

/**
 * The relay's `shieldInHandoff` flag transitions. RAISE must clear it: the
 * controller re-raises (reconcile after SW eviction / host reconnect) by aborting
 * the handoff and sending RAISE — not EXIT_HANDOFF — so if RAISE didn't clear the
 * flag, recording would stay silently suspended for the tab until a reload.
 */
describe('nextHandoffFlag', () => {
  it('ENTER_HANDOFF suspends (→ true)', () => {
    expect(nextHandoffFlag(false, 'ENTER_HANDOFF')).toBe(true);
  });
  it('EXIT_HANDOFF, LOWER, and RAISE all resume (→ false)', () => {
    expect(nextHandoffFlag(true, 'EXIT_HANDOFF')).toBe(false);
    expect(nextHandoffFlag(true, 'LOWER')).toBe(false);
    expect(nextHandoffFlag(true, 'RAISE')).toBe(false); // regression guard
  });
  it('LABEL leaves the flag unchanged', () => {
    expect(nextHandoffFlag(true, 'LABEL')).toBe(true);
    expect(nextHandoffFlag(false, 'LABEL')).toBe(false);
  });
});
