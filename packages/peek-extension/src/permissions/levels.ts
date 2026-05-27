/**
 * Five-level permission model (ADR-0010, P2 PRD §B.4). Defined here as shared
 * data so the side-panel selector (3d-1 placeholder) and the action-execution
 * wiring (3d-3) reference one source of truth.
 *
 * Default level is 1 (Read-only). The destructive-action blocklist overrides
 * ALL levels including 4 — that enforcement lands in 3d-3.
 */

export type PermissionLevel = 0 | 1 | 2 | 3 | 4;

export interface PermissionLevelInfo {
  level: PermissionLevel;
  name: string;
  behavior: string;
}

/** The canonical level table from ADR-0010. */
export const PERMISSION_LEVELS: readonly PermissionLevelInfo[] = [
  { level: 0, name: 'Off', behavior: 'Tool surface disabled entirely.' },
  {
    level: 1,
    name: 'Read-only',
    behavior: 'MCP can read sessions; no action execution.',
  },
  {
    level: 2,
    name: 'Suggest-only',
    behavior: 'MCP can highlight DOM via overlay; no DOM mutation.',
  },
  {
    level: 3,
    name: 'Act-with-confirm',
    behavior: 'Each action asks: Allow once / Always for this site / Deny.',
  },
  {
    level: 4,
    name: 'YOLO this session',
    behavior:
      'No prompts; auto-expires on tab close or 60 min. Destructive blocklist still applies.',
  },
] as const;

/** Default permission level on a freshly-enabled site (ADR-0010). */
export const DEFAULT_PERMISSION_LEVEL: PermissionLevel = 1;
