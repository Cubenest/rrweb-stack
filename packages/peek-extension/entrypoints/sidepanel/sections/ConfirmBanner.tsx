/**
 * Level-3 act-with-confirm banner (Task 3.24, Phase 3e, ADR-0010).
 *
 * When the SW receives an `execute_action`/`request_authorization` for a
 * Level-3 origin (and no valid confirmToken skipped it), it opens the side
 * panel and posts a {@link ShowConfirmMessage}. This banner renders the pending
 * action and the user's three choices: Allow once / Always for this site / Deny.
 *
 * Security posture (fail-closed): the verdict reducer + closed-panel default
 * both resolve to DENY for any non-affirmative path, and the typed text of a
 * `type` action is NEVER rendered (the banner describes the selector only).
 *
 * The pure functions (`nextVerdict`, `closedVerdict`, `describeAction`) carry
 * all the logic so they unit-test without React rendering; the component is a
 * thin presentational shell over them.
 */
import type { ConfirmVerdictMessage, ShowConfirmMessage } from '../../../src/messaging/protocol';
import type { Action } from '../../../src/permissions/action-protocol';

/** The three buttons the banner offers. */
export type ConfirmChoice = 'allow' | 'always' | 'deny';

/**
 * Map a user choice → the verdict message posted to the SW. Fail-closed: any
 * value other than `allow`/`always` denies. `always` also flags alwaysForSite.
 */
export function nextVerdict(requestId: string, choice: ConfirmChoice): ConfirmVerdictMessage {
  if (choice === 'allow') {
    return { type: 'confirmVerdict', requestId, verdict: 'allow', alwaysForSite: false };
  }
  if (choice === 'always') {
    return { type: 'confirmVerdict', requestId, verdict: 'allow', alwaysForSite: true };
  }
  return { type: 'confirmVerdict', requestId, verdict: 'deny', alwaysForSite: false };
}

/**
 * The default verdict when the panel unmounts / closes without a choice. The
 * `closed` flag (item F) lets the SW report this as 'panel-closed' in the audit
 * log, distinct from an explicit Deny-button click ('user-deny').
 */
export function closedVerdict(requestId: string): ConfirmVerdictMessage {
  return { type: 'confirmVerdict', requestId, verdict: 'deny', alwaysForSite: false, closed: true };
}

/**
 * Human-readable description of a pending action for the banner. NEVER renders
 * a `type` action's text (it may be a password) — only the selector.
 */
export function describeAction(action: Action): string {
  switch (action.type) {
    case 'click':
      return `Click ${action.selector}`;
    case 'type':
      return `Type into ${action.selector}`;
    case 'navigate':
      return `Navigate to ${action.url}`;
    case 'scroll':
      return action.selector ? `Scroll to ${action.selector}` : 'Scroll the page';
    case 'back':
      return 'Go back';
    case 'forward':
      return 'Go forward';
    case 'reload':
      return 'Reload the page';
    case 'screenshot':
      return 'Take a screenshot';
    case 'waitFor':
      return action.selector ? `Wait for ${action.selector}` : 'Wait';
    default:
      return 'Perform an action';
  }
}

export interface ConfirmBannerProps {
  pending: ShowConfirmMessage;
  /** Invoked with the chosen verdict; the parent posts it to the SW. */
  onResolve(verdict: ConfirmVerdictMessage): void;
}

/** Presentational banner. All decision logic lives in the pure fns above. */
export function ConfirmBanner({ pending, onResolve }: ConfirmBannerProps): React.JSX.Element {
  const choose = (choice: ConfirmChoice): void => {
    onResolve(nextVerdict(pending.requestId, choice));
  };
  return (
    <section
      className="peek-section peek-confirm-banner"
      role="alertdialog"
      aria-labelledby="peek-confirm-heading"
      aria-describedby="peek-confirm-desc"
    >
      <h2 id="peek-confirm-heading" className="peek-section-title">
        Allow this action?
      </h2>
      <p id="peek-confirm-desc" className="peek-confirm-action">
        {describeAction(pending.action)}
      </p>
      <p className="peek-muted">on {pending.origin}</p>
      {pending.destructiveTerm ? (
        <p className="peek-confirm-warning" role="alert">
          ⚠ This looks destructive ("{pending.destructiveTerm}"). Review carefully.
        </p>
      ) : null}
      <div className="peek-confirm-actions">
        <button type="button" className="peek-btn peek-btn-primary" onClick={() => choose('allow')}>
          Allow once
        </button>
        <button type="button" className="peek-btn" onClick={() => choose('always')}>
          Always for this site
        </button>
        <button type="button" className="peek-btn peek-btn-danger" onClick={() => choose('deny')}>
          Deny
        </button>
      </div>
    </section>
  );
}
