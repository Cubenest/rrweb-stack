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
  /** Schedule the handoff timeout. Returns an opaque handle for clearTimer. */
  setTimer(fn: () => void, ms: number): unknown;
  /** Cancel a handle returned by setTimer. */
  clearTimer(handle: unknown): void;
}

/**
 * Result of a blocking {@link ShieldController.enterHandoff}. Single `value`
 * covers both modes (free-text card OR the unlocked field's value). `readBack`
 * gates whether it's populated; password/OTP/cc never reach here.
 */
export type HandoffResult =
  | { resumed: true; value?: string }
  | { resumed: false; reason: 'timeout' | 'stopped' | 'busy' | 'ineligible' };

interface HandoffRecord {
  readBack: boolean;
  scope: 'field' | 'page';
  resolve: (r: HandoffResult) => void;
  timer: unknown;
}

interface TabState {
  phase: ShieldPhase;
  origin: string | null;
  label: string | null;
  // Agent-set banner string (Part 2). When non-null it wins over `label` in the
  // banner; cleared on #lower and by onSetIntent('').
  intentLabel: string | null;
  // `| undefined` (not bare `?`) so the take-and-clear `= undefined` slot reset
  // is legal under exactOptionalPropertyTypes.
  handoff?: HandoffRecord | undefined;
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
      s = { phase: 'down', origin: null, label: null, intentLabel: null };
      this.#tabs.set(tabId, s);
    }
    return s;
  }

  /**
   * Take-and-clear a pending handoff and settle it `stopped` — resolve-once,
   * no EXIT_HANDOFF and no phase change (the caller sets its own phase). The
   * single home for the abort half of the resolve-once invariant, shared by
   * every teardown that bypasses {@link #settleHandoff}: #raise, #lower, and
   * onTabClosed. Without it the record + scheduled timer survive and the
   * awaiting enterHandoff() promise stays blocked until the orphaned timer.
   */
  #abortHandoff(s: TabState): void {
    if (!s.handoff) return;
    const rec = s.handoff;
    s.handoff = undefined; // take-and-clear BEFORE resolving
    this.#deps.clearTimer(rec.timer);
    rec.resolve({ resumed: false, reason: 'stopped' });
  }

  /** Intent (agent-set) wins over the per-action label in the banner. */
  #effectiveLabel(s: TabState): string | null {
    return s.intentLabel ?? s.label;
  }

  /** Push a LABEL with the effective banner string (no-op while down). */
  #pushLabel(tabId: number, s: TabState): void {
    if (s.phase === 'down') return;
    this.#deps.commandView(tabId, {
      kind: 'LABEL',
      generation: ++this.#generation,
      label: this.#effectiveLabel(s),
    });
  }

  #raise(tabId: number, origin: string, s: TabState): void {
    // Settle any pending handoff as `stopped` FIRST (resolve-once), then raise.
    // Symmetric with #lower: any re-issue of an up-state while phase==='handoff'
    // (reconcile / onViewReady re-handshake / onHostConnectionChanged(true) /
    // onLevelChanged shouldBeUp && phase!=='up') reaches here.
    this.#abortHandoff(s);
    s.phase = 'up';
    s.origin = origin;
    this.#deps.commandView(tabId, {
      kind: 'RAISE',
      generation: ++this.#generation,
      label: this.#effectiveLabel(s),
    });
  }

  #lower(tabId: number, s: TabState): void {
    // Settle any pending handoff as `stopped` FIRST (resolve-once), then lower.
    this.#abortHandoff(s);
    s.phase = 'down';
    s.label = null;
    s.intentLabel = null;
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
    // Route through #pushLabel so a set intent automatically wins over the
    // per-action label.
    this.#pushLabel(tabId, s);
  }

  /** Agent-set banner string (Part 2). Empty string clears it. Level-gated upstream. */
  onSetIntent(tabId: number, text: string): void {
    const s = this.#state(tabId);
    s.intentLabel = text.length > 0 ? text : null;
    this.#pushLabel(tabId, s);
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
    // Settle any pending handoff first (resolve-once) so the awaiting
    // enterHandoff() promise isn't orphaned by the delete — the still-scheduled
    // timeout callback would then hit #settleHandoff with the tab already gone
    // and early-return without resolving. No EXIT_HANDOFF: the tab is closing.
    const s = this.#tabs.get(tabId);
    if (s) this.#abortHandoff(s);
    this.#tabs.delete(tabId);
  }

  /** Is the shield currently up for this tab? (read-only probe for the handler) */
  isUp(tabId: number): boolean {
    return this.#tabs.get(tabId)?.phase === 'up';
  }

  /**
   * Enter the input-handoff sub-state and block until the user resumes, the
   * timeout fires, or the shield is torn down. Single-slot per tab: a second
   * call while one is pending resolves `busy`. The controller stays DOM-free —
   * eligibility (`readBack`, value masking) is decided by the handler upstream.
   */
  enterHandoff(
    tabId: number,
    input: {
      prompt: string;
      framing: string;
      selector?: string;
      scope?: 'field' | 'page';
      readBack: boolean;
      timeoutMs: number;
    },
  ): Promise<HandoffResult> {
    const s = this.#state(tabId);
    // `busy` takes precedence: a pending handoff leaves phase==='handoff', so the
    // single-slot check must come before the up-guard (else it reports `stopped`).
    if (s.handoff) return Promise.resolve({ resumed: false, reason: 'busy' });
    if (s.phase !== 'up') return Promise.resolve({ resumed: false, reason: 'stopped' });
    return new Promise<HandoffResult>((resolve) => {
      const timer = this.#deps.setTimer(
        () => this.#settleHandoff(tabId, { resumed: false, reason: 'timeout' }),
        input.timeoutMs,
      );
      s.handoff = { readBack: input.readBack, scope: input.scope ?? 'field', resolve, timer };
      s.phase = 'handoff';
      this.#deps.commandView(tabId, {
        kind: 'ENTER_HANDOFF',
        generation: ++this.#generation,
        prompt: input.prompt,
        framing: input.framing,
        ...(input.selector !== undefined ? { selector: input.selector } : {}),
        // Default — if input.scope is undefined, omit it; the view treats absent
        // as 'field'.
        ...(input.scope !== undefined ? { scope: input.scope } : {}),
      });
    });
  }

  /** User resumed from the handoff prompt (shield.resume). No-op if already settled. */
  onUserResume(tabId: number, payload?: { value?: string }): void {
    const s = this.#tabs.get(tabId);
    if (!s?.handoff) return; // forgotten/already-settled → no-op (SW-restart safe)
    const rb = s.handoff.readBack;
    const result: HandoffResult =
      rb && payload?.value !== undefined
        ? { resumed: true, value: payload.value }
        : { resumed: true };
    this.#settleHandoff(tabId, result);
  }

  /** Resolve-once + clear timer + EXIT_HANDOFF, then return to 'up'. Idempotent. */
  #settleHandoff(tabId: number, result: HandoffResult): void {
    const s = this.#tabs.get(tabId);
    const rec = s?.handoff;
    if (!s || !rec) return; // already settled — no double-resolve
    s.handoff = undefined; // take-and-clear BEFORE resolving
    this.#deps.clearTimer(rec.timer);
    if (s.phase === 'handoff') {
      s.phase = 'up';
      this.#deps.commandView(tabId, { kind: 'EXIT_HANDOFF', generation: ++this.#generation });
    }
    rec.resolve(result);
  }

  /** Is this tab currently in the input-handoff sub-state? */
  isHandoff(tabId: number): boolean {
    return this.#tabs.get(tabId)?.phase === 'handoff';
  }

  /** Stop holds focus in BOTH up and handoff → both reject a selector-less enter. */
  isShieldActive(tabId: number): boolean {
    const p = this.#tabs.get(tabId)?.phase;
    return p === 'up' || p === 'handoff';
  }
}
