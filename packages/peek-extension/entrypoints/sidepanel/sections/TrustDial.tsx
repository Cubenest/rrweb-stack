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
                    onChange={() => void set(seg.level)}
                  />
                  <span>{seg.short}</span>
                </label>
              );
            })}
          </div>
          <p className="peek-dial-summary">{permissionLevelInfo(level).summary}</p>
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
