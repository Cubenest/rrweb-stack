/**
 * Per-tab RecorderStats accumulator (P2 PRD §D.3) — the live "127 DOM mutations
 * · 14 console logs · 9 network reqs" the side panel polls via
 * `getRecorderStats`. The SW folds each relay batch into the tab's running
 * totals; the side panel reads them back.
 *
 * Pure + unit-tested. The SW owns one instance and the `chrome.tabs.onRemoved`
 * cleanup wiring; this class owns the arithmetic + the per-tab map.
 */

import { EMPTY_RECORDER_STATS, type RecorderStats } from '../messaging/protocol.js';

export class RecorderStatsStore {
  private readonly byTab = new Map<number, RecorderStats>();

  /** Current stats for a tab (a fresh zeroed copy if the tab has none). */
  get(tabId: number): RecorderStats {
    const s = this.byTab.get(tabId);
    return s ? { ...s } : { ...EMPTY_RECORDER_STATS };
  }

  private mutate(tabId: number): RecorderStats {
    let s = this.byTab.get(tabId);
    if (!s) {
      s = { ...EMPTY_RECORDER_STATS };
      this.byTab.set(tabId, s);
    }
    return s;
  }

  /**
   * Fold an rrweb + console batch into a tab's totals. `domMutations` counts
   * every rrweb event (a coarse but honest "activity" proxy — the side panel
   * shows it as DOM mutations); console events are counted separately.
   */
  addEvents(tabId: number, rrwebCount: number, consoleCount: number): void {
    const s = this.mutate(tabId);
    s.domMutations += rrwebCount;
    s.consoleLogs += consoleCount;
  }

  /** Fold a network batch into a tab's totals (counts request records only). */
  addNetwork(tabId: number, requestCount: number): void {
    const s = this.mutate(tabId);
    s.networkRequests += requestCount;
  }

  /** Forget a tab's stats (on tab close / navigation reset). */
  clear(tabId: number): void {
    this.byTab.delete(tabId);
  }

  /** Number of tabs currently tracked (diagnostics/tests). */
  get trackedTabs(): number {
    return this.byTab.size;
  }
}
