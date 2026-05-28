import { useEffect, useState } from 'react';
import {
  DEFAULT_PERMISSION_LEVEL,
  PERMISSION_LEVELS,
  type PermissionLevel,
} from '../../../src/permissions/levels';
import { getPermissionLevel, setPermissionLevel } from '../../../src/permissions/store';

/**
 * Permission-level selector, Levels 0–4 (ADR-0010, P2 PRD §B.4).
 *
 * 3d-3 wiring: the radio reads + writes the per-origin level via
 * `permissions/store.ts` (chrome.storage.sync, sorted + de-duped). The SW
 * reads the same key on each `execute_action` to gate.
 *
 * Without an active origin (chrome:// pages etc.) the section renders a soft
 * disabled state — the levels are per-site and there's no site to assign to.
 */
export function PermissionLevelSection({
  origin,
}: {
  origin: string | null;
}): React.JSX.Element {
  const [selected, setSelected] = useState<PermissionLevel>(DEFAULT_PERMISSION_LEVEL);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoaded(false);
    if (!origin) {
      setSelected(DEFAULT_PERMISSION_LEVEL);
      setLoaded(true);
      return;
    }
    void getPermissionLevel(origin).then((level) => {
      if (!cancelled) {
        setSelected(level);
        setLoaded(true);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [origin]);

  async function onChange(next: PermissionLevel): Promise<void> {
    if (!origin) return;
    setError(null);
    setBusy(true);
    const prev = selected;
    setSelected(next); // optimistic
    try {
      await setPermissionLevel(origin, next);
    } catch (err) {
      setSelected(prev); // rollback on error
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  const disabled = !origin || !loaded;

  return (
    <section className="peek-section" aria-labelledby="peek-perm-heading">
      <h2 id="peek-perm-heading" className="peek-section-title">
        Agent permission level
      </h2>
      {origin === null && (
        <p className="peek-muted peek-placeholder">
          Open this panel on an http(s) page to set per-site permissions.
        </p>
      )}
      {origin !== null && (
        <p className="peek-muted">
          For <code>{origin}</code>. Levels override per origin; YOLO Level 4 still confirms
          destructive actions.
        </p>
      )}
      <ul className="peek-levels">
        {PERMISSION_LEVELS.map((info) => (
          <li key={info.level} className="peek-level">
            <label className="peek-level-label">
              <input
                type="radio"
                name="peek-permission-level"
                value={info.level}
                checked={selected === info.level}
                onChange={() => {
                  void onChange(info.level);
                }}
                disabled={disabled || busy}
              />
              <span className="peek-level-name">
                {info.level}. {info.name}
              </span>
            </label>
            <span className="peek-level-behavior peek-muted">{info.behavior}</span>
          </li>
        ))}
      </ul>
      {error !== null && (
        <p className="peek-error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
