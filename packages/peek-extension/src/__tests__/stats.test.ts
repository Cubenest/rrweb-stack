import { describe, expect, it } from 'vitest';
import { RecorderStatsStore } from '../background/stats';

describe('RecorderStatsStore', () => {
  it('returns zeroed stats for an untracked tab', () => {
    const s = new RecorderStatsStore();
    expect(s.get(7)).toEqual({ domMutations: 0, consoleLogs: 0, networkRequests: 0 });
    expect(s.trackedTabs).toBe(0);
  });

  it('accumulates event + console counts per tab', () => {
    const s = new RecorderStatsStore();
    s.addEvents(1, 10, 2);
    s.addEvents(1, 5, 1);
    expect(s.get(1)).toEqual({ domMutations: 15, consoleLogs: 3, networkRequests: 0 });
  });

  it('accumulates network request counts per tab', () => {
    const s = new RecorderStatsStore();
    s.addNetwork(1, 3);
    s.addNetwork(1, 2);
    expect(s.get(1).networkRequests).toBe(5);
  });

  it('keeps tabs independent', () => {
    const s = new RecorderStatsStore();
    s.addEvents(1, 10, 0);
    s.addEvents(2, 4, 0);
    expect(s.get(1).domMutations).toBe(10);
    expect(s.get(2).domMutations).toBe(4);
    expect(s.trackedTabs).toBe(2);
  });

  it('returns a copy (callers cannot mutate internal state)', () => {
    const s = new RecorderStatsStore();
    s.addEvents(1, 10, 0);
    const snapshot = s.get(1);
    snapshot.domMutations = 999;
    expect(s.get(1).domMutations).toBe(10);
  });

  it('clear() forgets a tab', () => {
    const s = new RecorderStatsStore();
    s.addEvents(1, 10, 0);
    s.clear(1);
    expect(s.get(1).domMutations).toBe(0);
    expect(s.trackedTabs).toBe(0);
  });
});
