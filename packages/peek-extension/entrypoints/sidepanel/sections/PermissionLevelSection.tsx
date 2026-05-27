import { useState } from 'react';
import {
  DEFAULT_PERMISSION_LEVEL,
  PERMISSION_LEVELS,
  type PermissionLevel,
} from '../../../src/permissions/levels';

/**
 * Permission-level selector, Levels 0–4 (ADR-0010, P2 PRD §B.4).
 *
 * PLACEHOLDER (3d-1): renders the real level table and lets the user pick, but
 * the selection is local component state only — it is NOT persisted and does
 * NOT gate action execution yet. Full wiring (persist per-site level, enforce
 * at the MCP `execute_action` boundary, destructive blocklist) is chunk 3d-3.
 */
export function PermissionLevelSection(): React.JSX.Element {
  const [selected, setSelected] = useState<PermissionLevel>(DEFAULT_PERMISSION_LEVEL);

  return (
    <section className="peek-section" aria-labelledby="peek-perm-heading">
      <h2 id="peek-perm-heading" className="peek-section-title">
        Agent permission level
      </h2>
      <ul className="peek-levels">
        {PERMISSION_LEVELS.map((info) => (
          <li key={info.level} className="peek-level">
            <label className="peek-level-label">
              <input
                type="radio"
                name="peek-permission-level"
                value={info.level}
                checked={selected === info.level}
                onChange={() => setSelected(info.level)}
              />
              <span className="peek-level-name">
                {info.level}. {info.name}
              </span>
            </label>
            <span className="peek-level-behavior peek-muted">{info.behavior}</span>
          </li>
        ))}
      </ul>
      <p className="peek-muted peek-placeholder">
        Selection isn&rsquo;t saved yet &mdash; enforcement arrives in a later build.
      </p>
    </section>
  );
}
