/**
 * Level-4 YOLO session tracker (Task 3.22 / ADR-0010 action item #3).
 *
 * Level 4 "YOLO this session" is *not* a persistent storage state — it auto-
 * expires on whichever happens first:
 *   - the tab the user enabled it on is closed
 *   - 60 minutes elapse
 *
 * On expiry the origin reverts to the persistent level the user had selected
 * before flipping to YOLO (the "floor"), so when the SW reads the effective
 * level it sees the safer choice. The destructive-action blocklist still
 * overrides Level 4 regardless — enforced at dispatch time, not here.
 *
 * This module is pure logic + an injected clock + an injected setTimeout, so
 * the unit tests advance fake timers and verify expiry without a browser. The
 * background SW owns the side effects:
 *   - hooks `chrome.tabs.onRemoved` → calls {@link YoloSessionStore.onTabClosed}
 *   - the constructor schedules a 60-min `setTimeout` per activation
 *
 * Persistence: we deliberately do NOT persist L4 state across SW restarts. MV3
 * SWs die after 5 min idle; "session" in the level's name *means* this SW
 * instance. If the SW restarts mid-YOLO we revert to the persistent floor —
 * fail closed.
 */

import type { PermissionLevel } from './levels.js';

/** 60 minutes in milliseconds — the ADR-0010 maximum YOLO lifetime. */
export const YOLO_MAX_LIFETIME_MS = 60 * 60 * 1000;

export interface YoloActivation {
  /** Origin the YOLO grant applies to. */
  readonly origin: string;
  /** Tab the user activated YOLO on. Closing this tab expires the grant. */
  readonly tabId: number;
  /** ms-since-epoch when YOLO was activated. */
  readonly activatedAt: number;
  /** The persistent level to revert to on expiry (e.g. 3 Act-with-confirm). */
  readonly floor: PermissionLevel;
}

export interface YoloStoreDeps {
  /** Returns the current time in ms-since-epoch (injected for tests). */
  now(): number;
  /** Schedules `cb` to run after `ms`. Returns a handle the store can clear. */
  setTimeout(cb: () => void, ms: number): unknown;
  /** Cancels a handle from `setTimeout`. */
  clearTimeout(handle: unknown): void;
}

/** Default deps: real `Date.now` + global `setTimeout` / `clearTimeout`. */
export const defaultYoloDeps: YoloStoreDeps = {
  now: () => Date.now(),
  setTimeout: (cb, ms) => setTimeout(cb, ms),
  clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

/**
 * Tracks the per-origin Level-4 grants currently active in this SW instance.
 *
 * Lookup is by origin (one origin at a time can be in YOLO — re-entering YOLO
 * for the same origin replaces the prior grant and resets the timer). The
 * "anchoring" tab is recorded so closing that tab expires the grant immediately.
 */
export class YoloSessionStore {
  readonly #deps: YoloStoreDeps;
  /** origin → activation record. */
  readonly #active = new Map<string, YoloActivation>();
  /** origin → timer handle so we can clear on replace / explicit revoke. */
  readonly #timers = new Map<string, unknown>();
  /** Notified when an origin's YOLO lifetime ends (for any reason). */
  readonly #expiryListeners = new Set<(origin: string, floor: PermissionLevel) => void>();

  constructor(deps: YoloStoreDeps = defaultYoloDeps) {
    this.#deps = deps;
  }

  /**
   * Begin a YOLO grant for `origin` anchored to `tabId`. Replaces any
   * existing grant for that origin (resetting the 60-min timer). `floor` is
   * the persistent level we revert to on expiry.
   */
  activate(origin: string, tabId: number, floor: PermissionLevel): YoloActivation {
    // Clear any prior timer first so we don't fire a stale expiry.
    const existingTimer = this.#timers.get(origin);
    if (existingTimer !== undefined) this.#deps.clearTimeout(existingTimer);

    const record: YoloActivation = {
      origin,
      tabId,
      activatedAt: this.#deps.now(),
      floor,
    };
    this.#active.set(origin, record);

    const timer = this.#deps.setTimeout(() => {
      // Timer fired — expire if the record is still the one we scheduled for.
      // (A later activate() would have replaced the record AND the timer; this
      // belt-and-suspenders check costs nothing.)
      const current = this.#active.get(origin);
      if (current === record) this.#expire(origin, floor);
    }, YOLO_MAX_LIFETIME_MS);
    this.#timers.set(origin, timer);

    return record;
  }

  /** Is `origin` currently in YOLO? */
  isActive(origin: string): boolean {
    return this.#active.has(origin);
  }

  /** The activation record, if active. */
  get(origin: string): YoloActivation | undefined {
    return this.#active.get(origin);
  }

  /**
   * Called by the SW from its `chrome.tabs.onRemoved` listener. Expires any
   * YOLO grants anchored to this tab. Multiple origins could be anchored to
   * the same tab (rare but possible).
   */
  onTabClosed(tabId: number): void {
    for (const [origin, rec] of this.#active.entries()) {
      if (rec.tabId === tabId) this.#expire(origin, rec.floor);
    }
  }

  /** Explicitly revoke (e.g. side panel "Cancel YOLO" button). */
  revoke(origin: string): void {
    const rec = this.#active.get(origin);
    if (rec) this.#expire(origin, rec.floor);
  }

  /**
   * Subscribe to expiry notifications. The SW uses this to update its
   * in-memory effective-level cache and (optionally) ping the side panel so
   * the UI reflects the revert.
   *
   * @returns an unsubscribe function.
   */
  onExpiry(listener: (origin: string, floor: PermissionLevel) => void): () => void {
    this.#expiryListeners.add(listener);
    return () => {
      this.#expiryListeners.delete(listener);
    };
  }

  /** Number of currently-active YOLO grants (used by side-panel diagnostics). */
  get activeCount(): number {
    return this.#active.size;
  }

  #expire(origin: string, floor: PermissionLevel): void {
    const timer = this.#timers.get(origin);
    if (timer !== undefined) this.#deps.clearTimeout(timer);
    this.#timers.delete(origin);
    this.#active.delete(origin);
    for (const cb of this.#expiryListeners) {
      try {
        cb(origin, floor);
      } catch (err) {
        // A listener throwing must not prevent other listeners from firing —
        // log + continue. (We use console.warn rather than throw, so the SW's
        // message handler never tears down on an expiry side effect.)
        console.warn('[peek] yolo expiry listener threw:', err);
      }
    }
  }
}
