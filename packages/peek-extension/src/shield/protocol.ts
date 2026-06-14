/**
 * Shield SW <-> isolated-world view wire types (Plan A — lockout only).
 * Mirrors the messaging idiom in src/messaging/protocol.ts: discriminated
 * union by `type`/`kind`, fire-and-forget pushes, type guards on receive.
 */

/** Plan A has two phases; Plan B adds 'handoff'. */
export type ShieldPhase = 'down' | 'up';

/**
 * SW -> view command (sent via chrome.tabs.sendMessage to frameId 0).
 * `generation` is bumped by the controller on every RAISE/LOWER; the view
 * drops any command whose generation is older than the last it applied.
 */
export type ViewCommand = { generation: number } & (
  | { kind: 'RAISE'; label: string | null }
  | { kind: 'LABEL'; label: string | null }
  | { kind: 'LOWER' }
);

/** view -> SW messages (sent via chrome.runtime.sendMessage). */
export type ShieldInbound = { type: 'shield.ready'; generation: number } | { type: 'shield.stop' };

/** Type guard for {@link ViewCommand} (view-side receive). */
export function isViewCommand(msg: unknown): msg is ViewCommand {
  if (typeof msg !== 'object' || msg === null) return false;
  const m = msg as { kind?: unknown; generation?: unknown; label?: unknown };
  if (typeof m.generation !== 'number') return false;
  if (m.kind === 'RAISE' || m.kind === 'LABEL') {
    return m.label === null || typeof m.label === 'string';
  }
  return m.kind === 'LOWER';
}

/** Type guard for {@link ShieldInbound} (SW-side receive). */
export function isShieldInbound(msg: unknown): msg is ShieldInbound {
  if (typeof msg !== 'object' || msg === null) return false;
  const m = msg as { type?: unknown; generation?: unknown };
  if (m.type === 'shield.stop') return true;
  if (m.type === 'shield.ready') return typeof m.generation === 'number';
  return false;
}
