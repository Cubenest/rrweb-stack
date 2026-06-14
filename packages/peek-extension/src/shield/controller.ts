import type { ShieldPhase, ViewCommand } from './protocol';

export interface ShieldControllerDeps {
  /** Send a command to the view in `tabId` (chrome.tabs.sendMessage, frameId 0). */
  commandView(tabId: number, cmd: ViewCommand): void;
  /** Hard-drop the origin out of acting (setPermissionLevel(origin,1) + yolo.revoke). */
  dropToSafeLevel(origin: string): Promise<void>;
  /** Is the native host currently connected (peek can actually drive). */
  isHostConnected(): boolean;
  /** Effective level for an origin (yolo.isActive?4:persistent). Used by reconcile. */
  getEffectiveLevel(origin: string): Promise<number>;
}

interface TabState {
  phase: ShieldPhase;
  origin: string | null;
  label: string | null;
}

/** Lowest level at which the shield is shown. */
const SHIELD_LEVEL = 4;

/**
 * Pure SW state machine for the Level-4 control shield (Plan A: down/up only).
 * No chrome.* — every effect goes through {@link ShieldControllerDeps}.
 */
export class ShieldController {
  readonly #deps: ShieldControllerDeps;
  readonly #tabs = new Map<number, TabState>();
  /** Monotonic, stamped on every command; never reset within a controller instance. */
  #generation = 0;

  constructor(deps: ShieldControllerDeps) {
    this.#deps = deps;
  }

  #state(tabId: number): TabState {
    let s = this.#tabs.get(tabId);
    if (!s) {
      s = { phase: 'down', origin: null, label: null };
      this.#tabs.set(tabId, s);
    }
    return s;
  }

  #raise(tabId: number, origin: string, s: TabState): void {
    s.phase = 'up';
    s.origin = origin;
    this.#deps.commandView(tabId, {
      kind: 'RAISE',
      generation: ++this.#generation,
      label: s.label,
    });
  }

  #lower(tabId: number, s: TabState): void {
    s.phase = 'down';
    s.label = null;
    this.#deps.commandView(tabId, { kind: 'LOWER', generation: ++this.#generation });
  }

  /** A per-origin level change for a specific tab (fanned out by background.ts). */
  onLevelChanged(tabId: number, origin: string, level: number): void {
    const s = this.#state(tabId);
    const shouldBeUp = level >= SHIELD_LEVEL && this.#deps.isHostConnected();
    if (shouldBeUp && s.phase !== 'up') this.#raise(tabId, origin, s);
    else if (!shouldBeUp && s.phase !== 'down') this.#lower(tabId, s);
  }

  /** Native host connect/disconnect. On disconnect, tear down every up tab. */
  onHostConnectionChanged(connected: boolean): void {
    if (connected) {
      // Re-derive each known tab from durable level.
      for (const [tabId, s] of this.#tabs) {
        if (s.origin) void this.reconcile(tabId, s.origin);
      }
      return;
    }
    for (const [tabId, s] of this.#tabs) {
      if (s.phase !== 'down') this.#lower(tabId, s);
    }
  }

  /** Update the banner label for the action peek is dispatching (up only). */
  onActionLabel(tabId: number, label: string): void {
    const s = this.#state(tabId);
    if (s.phase !== 'up') return;
    s.label = label;
    this.#deps.commandView(tabId, { kind: 'LABEL', generation: ++this.#generation, label });
  }

  /**
   * User hit Stop. Does NOT itself LOWER: dropping the level writes storage,
   * which fans back through onLevelChanged(<4) — the single teardown path.
   */
  async onStop(tabId: number): Promise<void> {
    const s = this.#tabs.get(tabId);
    if (!s?.origin) return;
    await this.#deps.dropToSafeLevel(s.origin);
  }

  /** View handshake (mount / re-inject / SW wake). `viewGen` = the view's lastApplied. */
  async onViewReady(tabId: number, origin: string, viewGen: number): Promise<void> {
    if (viewGen > this.#generation) this.#generation = viewGen;
    await this.reconcile(tabId, origin);
  }

  /** Re-derive the correct phase from durable level + host state and re-issue it. */
  async reconcile(tabId: number, origin: string): Promise<void> {
    const level = await this.#deps.getEffectiveLevel(origin);
    const s = this.#state(tabId);
    const shouldBeUp = level >= SHIELD_LEVEL && this.#deps.isHostConnected();
    // Always re-issue (repair the view) at a fresh generation.
    if (shouldBeUp) this.#raise(tabId, origin, s);
    else this.#lower(tabId, s);
  }

  /** Forget a closed tab. */
  onTabClosed(tabId: number): void {
    this.#tabs.delete(tabId);
  }

  /** Is the shield currently up for this tab? (read-only probe for the handler) */
  isUp(tabId: number): boolean {
    return this.#tabs.get(tabId)?.phase === 'up';
  }
}
