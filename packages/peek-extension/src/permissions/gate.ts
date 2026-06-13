/**
 * The pure permission-gating decision (Task 3.22 + 3.23).
 *
 * Given:
 *   - the per-origin permission level (0..4)
 *   - whether the action's resolved target is destructive (override)
 *
 * Produce a verdict the SW can dispatch on:
 *   - `'deny'`   → tool surface disabled at this level; reply "not authorized"
 *   - `'confirm'`→ surface the side-panel banner; await user click
 *   - `'allow'`  → auto-allow (Level 4 non-destructive)
 *
 * Single source of truth so the SW, the side-panel banner copy, and the audit
 * log all agree on what "allow / confirm / deny" means. Pure: level + flag in,
 * verdict out, no side effects, fully unit-testable.
 *
 * Edge case the brief calls out: at Level 0 (Off), execute_action returns
 * "not authorized" AND recording is suppressed on the site. Recording
 * suppression is enforced separately (the SW gates `injectRecorder` /
 * `forwardToHost` on the level too); this gate's job is only the action
 * verdict.
 */

import type { PermissionLevel } from './levels.js';

export type ActionVerdict = 'allow' | 'confirm' | 'deny';

export interface GateInput {
  /** Per-origin level for the site the action targets (after YOLO resolution). */
  readonly level: PermissionLevel;
  /**
   * Whether the destructive matcher fired on the resolved DOM target. The
   * MAIN-world dispatcher reads the target's text / aria-label / nearby
   * heading and runs `matchDestructive` BEFORE asking the SW to gate — that
   * way the matcher sees the same DOM the user would.
   *
   * For requests that have no DOM target (navigate / back / forward / reload),
   * pass `false`; the destructive override is button-text-driven and doesn't
   * apply.
   */
  readonly destructive: boolean;
}

export interface GateResult {
  readonly verdict: ActionVerdict;
  /** A short why-string for the audit log + diagnostics. */
  readonly reason: string;
}

/**
 * Decide whether to allow / confirm / deny an action.
 *
 * Decision table (ADR-0010 §B.4):
 *
 *   level  destructive?   verdict
 *   ─────  ────────────   ────────
 *   0      —              deny      (off)
 *   1      —              deny      (read-only)
 *   2      —              deny      (suggest-only: highlight is NOT
 *                                    `execute_action`; the highlight overlay
 *                                    runs through a separate non-mutating path)
 *   3      —              confirm   (every action prompts)
 *   4      false          allow     (YOLO non-destructive)
 *   4      true           confirm   (destructive override beats YOLO)
 */
export function gate(input: GateInput): GateResult {
  switch (input.level) {
    case 0:
      return { verdict: 'deny', reason: 'level-0-off' };
    case 1:
      return { verdict: 'deny', reason: 'level-1-read-only' };
    case 2:
      // Level 2 is the "Suggest" tier: the highlight / clear_highlight actions
      // are intercepted in action-handler.ts BEFORE this gate and auto-allowed
      // at Level >= 2 via a separate non-mutating overlay path. An
      // `execute_action` MUTATION is still denied here.
      return { verdict: 'deny', reason: 'level-2-suggest-only' };
    case 3:
      return { verdict: 'confirm', reason: 'level-3-act-with-confirm' };
    case 4:
      if (input.destructive) {
        return { verdict: 'confirm', reason: 'level-4-destructive-override' };
      }
      return { verdict: 'allow', reason: 'level-4-yolo' };
    default: {
      // Exhaustiveness guard: TypeScript narrows `input.level` to `never`
      // here; if a sixth level ever lands, the compiler flags this branch.
      const exhaustive: never = input.level;
      throw new Error(`gate: unknown permission level ${String(exhaustive)}`);
    }
  }
}
