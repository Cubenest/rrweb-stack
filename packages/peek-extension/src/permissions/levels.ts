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
  /** Short label for the trust-dial segment (side-panel redesign). */
  short: string;
  behavior: string;
  /** Plain-language sentence shown under the active dial stop. */
  summary: string;
}

/** The canonical level table from ADR-0010. */
export const PERMISSION_LEVELS: readonly PermissionLevelInfo[] = [
  {
    level: 0,
    name: 'Off',
    short: 'Off',
    behavior: 'Tool surface disabled entirely.',
    summary: "Your agent can't see or touch this site — peek's tools are turned off here.",
  },
  {
    level: 1,
    name: 'Read-only',
    short: 'Read',
    behavior: 'MCP can read sessions; no action execution.',
    summary:
      "Your agent can read what peek captured here, but can't click, type, or change anything.",
  },
  {
    level: 2,
    name: 'Suggest-only',
    short: 'Suggest',
    behavior: 'MCP can highlight DOM via overlay; no DOM mutation.',
    summary:
      "Your agent can highlight things on the page to point them out, but can't change anything.",
  },
  {
    level: 3,
    name: 'Act-with-confirm',
    short: 'Confirm',
    behavior: 'Each action asks: Allow once / Always for this site / Deny.',
    summary:
      'Your agent can click, type, and navigate — but asks you to approve each action first.',
  },
  {
    level: 4,
    name: 'YOLO this session',
    short: 'Auto',
    behavior:
      'No prompts; auto-expires on tab close or 60 min. Destructive blocklist still applies.',
    summary:
      'Your agent acts on its own, no prompts. Ends when you close the tab or after 60 minutes. Destructive actions still ask first.',
  },
] as const;

/** Default permission level on a freshly-enabled site (ADR-0010). */
export const DEFAULT_PERMISSION_LEVEL: PermissionLevel = 1;

/** Look up the level table entry for a level value. Throws on an unknown level. */
export function permissionLevelInfo(level: PermissionLevel): PermissionLevelInfo {
  const info = PERMISSION_LEVELS.find((i) => i.level === level);
  if (!info) throw new Error(`unknown permission level: ${level}`);
  return info;
}
