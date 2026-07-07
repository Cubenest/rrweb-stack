/**
 * SP4 connector-pairing trust-dial prompt (Task 5).
 *
 * When the SW receives a `pair.request` from the native host (a connector
 * asking to pair), it opens the side panel and posts a {@link ShowPairMessage}.
 * This banner renders the pending pairing prompt and the user's two choices:
 * Approve / Deny. The matching code lets the user verify the connector's
 * identity out-of-band.
 *
 * Security posture (fail-closed): the SW fail-closes to `approved:false` on
 * timeout; an explicit Deny-button click also produces `approved:false`. The
 * plaintext secret is minted SW-side only on `approved:true`.
 *
 * The pure helper (`pairVerdict`) carries the verdict-construction logic so it
 * unit-tests without React rendering; the component is a thin presentational
 * shell over it.
 */

import type { PairVerdictMessage, ShowPairMessage } from '../../../src/messaging/protocol';
import { sendPairVerdict } from '../../../src/messaging/protocol';

/** The two choices the pairing banner offers. */
export type PairChoice = 'approve' | 'deny';

/**
 * Map a user choice → the verdict message posted to the SW. Fail-closed: any
 * value other than `approve` denies.
 */
export function pairVerdict(requestId: string, choice: PairChoice): PairVerdictMessage {
  return {
    type: 'pairVerdict',
    requestId,
    approved: choice === 'approve',
  };
}

export interface PairBannerProps {
  pending: ShowPairMessage;
  /** Invoked with the chosen verdict; the parent posts it to the SW. */
  onResolve(verdict: PairVerdictMessage): void;
}

/** Presentational banner. All decision logic lives in the pure fn above. */
export function PairBanner({ pending, onResolve }: PairBannerProps): React.JSX.Element {
  const choose = (choice: PairChoice): void => {
    onResolve(pairVerdict(pending.requestId, choice));
  };
  return (
    <section
      className="peek-section peek-pair-banner"
      role="alertdialog"
      aria-labelledby="peek-pair-heading"
      aria-describedby="peek-pair-desc"
    >
      <h2 id="peek-pair-heading" className="peek-section-title">
        Approve connector pairing?
      </h2>
      <p id="peek-pair-desc" className="peek-pair-client">
        <strong>{pending.clientName}</strong> wants to pair with peek.
      </p>
      <p className="peek-muted">
        Matching code: <code className="peek-pair-code">{pending.code}</code>
      </p>
      <p className="peek-muted">
        Verify this code matches what your connector shows before approving.
      </p>
      <div className="peek-confirm-actions">
        <button
          type="button"
          className="peek-btn peek-btn-primary"
          onClick={() => choose('approve')}
        >
          Approve
        </button>
        <button type="button" className="peek-btn peek-btn-danger" onClick={() => choose('deny')}>
          Deny
        </button>
      </div>
    </section>
  );
}

/**
 * Post a pair verdict back to the SW. Best-effort; SW fail-closes on no reply.
 * Re-exported here so App.tsx can call it from the onResolve callback without
 * importing from protocol.ts directly — mirrors how ConfirmBanner is wired.
 */
export { sendPairVerdict };
