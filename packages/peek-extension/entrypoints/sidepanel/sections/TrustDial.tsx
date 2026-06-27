import { useEffect, useState } from 'react';
import {
  PERMISSION_LEVELS,
  type PermissionLevel,
  permissionLevelInfo,
} from '../../../src/permissions/levels';
import { usePermissionLevel } from '../usePermissionLevel';

export interface DialSegment {
  level: PermissionLevel;
  short: string;
}

/**
 * True when selecting `next` should pop the explicit Level-4 (Auto) warning:
 * only when raising TO Level 4 from a lower level. Re-selecting 4, or moving to
 * any lower level, never warns.
 */
export function needsAutoWarning(current: PermissionLevel, next: PermissionLevel): boolean {
  return next === 4 && current !== 4;
}

export interface LegendEntry {
  level: PermissionLevel;
  name: string;
  behavior: string;
}

/** The full five-level ladder (name + behavior) for the legend disclosure. */
export function legendEntries(): LegendEntry[] {
  return PERMISSION_LEVELS.map((l) => ({ level: l.level, name: l.name, behavior: l.behavior }));
}

/** Pure: the ordered dial segments (Off → Auto). */
export function dialSegments(): DialSegment[] {
  return PERMISSION_LEVELS.map((info) => ({ level: info.level, short: info.short }));
}

/** Stable segment list — the levels never change at runtime. */
const SEGMENTS: readonly DialSegment[] = dialSegments();

/**
 * The trust dial: the five permission levels as one left→right escalation,
 * backed by real radio inputs (a radiogroup) for keyboard + screen-reader
 * support, visually styled as a segmented control. Reads/writes the per-origin
 * level via the shared usePermissionLevel hook.
 */
export function TrustDial({ origin }: { origin: string | null }): React.JSX.Element {
  const { level, loaded, busy, error, set } = usePermissionLevel(origin);
  const disabled = !origin || !loaded || busy;

  const [pendingAuto, setPendingAuto] = useState(false);

  // Defensive: if the active origin changes, drop any armed Level-4 warning so
  // it can't carry over to a different site. origin is the intentional trigger.
  // biome-ignore lint/correctness/useExhaustiveDependencies: setPendingAuto is stable; origin is the intentional reset signal.
  useEffect(() => {
    setPendingAuto(false);
  }, [origin]);

  const onSelect = (next: PermissionLevel): void => {
    if (needsAutoWarning(level, next)) {
      setPendingAuto(true);
      return;
    }
    // Any non-4 selection backs down from an armed warning — clear it so the
    // "Enable auto-approve" button can't stay armed after the user retreats.
    setPendingAuto(false);
    void set(next);
  };

  const confirmAuto = (): void => {
    setPendingAuto(false);
    void set(4);
  };

  const cancelAuto = (): void => {
    setPendingAuto(false);
  };

  return (
    <div className="peek-agent">
      <p className="peek-agent-q">
        What can your agent do
        {origin ? (
          <>
            {' '}
            on <code>{origin}</code>
          </>
        ) : null}
        ?
      </p>
      {origin === null ? (
        <p className="peek-muted peek-placeholder">
          Open this panel on an http(s) page to set what your agent can do.
        </p>
      ) : (
        <>
          <div className="peek-dial" role="radiogroup" aria-label="Agent permission level">
            {SEGMENTS.map((seg) => {
              const active = seg.level === level;
              return (
                <label key={seg.level} className={`peek-dial-seg${active ? ' peek-dial-on' : ''}`}>
                  <input
                    type="radio"
                    name="peek-permission-level"
                    className="peek-dial-input"
                    value={seg.level}
                    checked={active}
                    disabled={disabled}
                    onChange={() => onSelect(seg.level)}
                  />
                  <span>{seg.short}</span>
                </label>
              );
            })}
          </div>
          {pendingAuto ? (
            <div className="peek-auto-warning" role="alertdialog" aria-label="Enable auto-approve?">
              <p>
                Auto-approve lets your agent act on this site without asking, and stays on until you
                turn it off or lower the trust level. Destructive actions still ask first.
                {origin ? (
                  <>
                    {' '}
                    Enable for <code>{origin}</code>?
                  </>
                ) : null}
              </p>
              <div className="peek-auto-warning-actions">
                <button type="button" className="peek-btn peek-btn-danger" onClick={confirmAuto}>
                  Enable auto-approve
                </button>
                <button type="button" className="peek-btn" onClick={cancelAuto}>
                  Cancel
                </button>
              </div>
            </div>
          ) : null}
          <p className="peek-dial-summary">{permissionLevelInfo(level).summary}</p>
          <details className="peek-level-legend">
            <summary>What do these levels mean?</summary>
            <ul className="peek-level-legend-list">
              {legendEntries().map((e) => (
                <li key={e.level}>
                  <strong>
                    {e.level}. {e.name}
                  </strong>{' '}
                  — {e.behavior}
                </li>
              ))}
            </ul>
          </details>
        </>
      )}
      {error !== null && (
        <p className="peek-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
