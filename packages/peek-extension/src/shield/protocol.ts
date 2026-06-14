/**
 * Shield SW <-> isolated-world view wire types (Plan A — lockout only).
 * Mirrors the messaging idiom in src/messaging/protocol.ts: discriminated
 * union by `type`/`kind`, fire-and-forget pushes, type guards on receive.
 */

/** Plan A had 'down'|'up'; Plan B adds 'handoff' (the input-handoff sub-state). */
export type ShieldPhase = 'down' | 'up' | 'handoff';

/**
 * SW -> view command (sent via chrome.tabs.sendMessage to frameId 0).
 * `generation` is bumped by the controller on every RAISE/LOWER; the view
 * drops any command whose generation is older than the last it applied.
 */
export type ViewCommand = { generation: number } & (
  | { kind: 'RAISE'; label: string | null }
  | { kind: 'LABEL'; label: string | null }
  | { kind: 'LOWER' }
  | { kind: 'ENTER_HANDOFF'; prompt: string; framing: string; selector?: string }
  | { kind: 'EXIT_HANDOFF' }
);

/** view -> SW messages (sent via chrome.runtime.sendMessage). */
export type ShieldInbound =
  | { type: 'shield.ready'; generation: number }
  | { type: 'shield.stop' }
  | { type: 'shield.resume'; value?: string };

/** Type guard for {@link ViewCommand} (view-side receive). */
export function isViewCommand(msg: unknown): msg is ViewCommand {
  if (typeof msg !== 'object' || msg === null) return false;
  const m = msg as {
    kind?: unknown;
    generation?: unknown;
    label?: unknown;
    prompt?: unknown;
    framing?: unknown;
    selector?: unknown;
  };
  if (typeof m.generation !== 'number') return false;
  if (m.kind === 'RAISE' || m.kind === 'LABEL') {
    return m.label === null || typeof m.label === 'string';
  }
  if (m.kind === 'LOWER' || m.kind === 'EXIT_HANDOFF') return true;
  if (m.kind === 'ENTER_HANDOFF') {
    if (typeof m.prompt !== 'string' || typeof m.framing !== 'string') return false;
    return m.selector === undefined || typeof m.selector === 'string';
  }
  return false;
}

/** Type guard for {@link ShieldInbound} (SW-side receive). */
export function isShieldInbound(msg: unknown): msg is ShieldInbound {
  if (typeof msg !== 'object' || msg === null) return false;
  const m = msg as { type?: unknown; generation?: unknown; value?: unknown };
  if (m.type === 'shield.stop') return true;
  if (m.type === 'shield.ready') return typeof m.generation === 'number';
  if (m.type === 'shield.resume') return m.value === undefined || typeof m.value === 'string';
  return false;
}
