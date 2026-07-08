// ConnectorDescriptor registry — static metadata about each supported surface.
// peek-cli imports NO connector implementation code; it only knows how to spawn
// each surface's connector as a subprocess.  `resolveSpawn` merges the
// per-entry overrides from connectors.json with the defaults defined here.

import type { ConnectorEntry } from './registry.js';

// ── Types ──────────────────────────────────────────────────────────────────

export interface ConnectorDescriptor {
  surface: string;
  displayName: string;
  defaultCommand: string;
  defaultArgs: string[];
}

// ── Built-in descriptors ───────────────────────────────────────────────────

export const DESCRIPTORS: Record<string, ConnectorDescriptor> = {
  slack: {
    surface: 'slack',
    displayName: 'Slack',
    defaultCommand: 'peek-connector-slack',
    defaultArgs: [],
  },
};

// ── Lookup ─────────────────────────────────────────────────────────────────

/** Returns the descriptor for `surface`, or `undefined` if not registered. */
export function getDescriptor(surface: string): ConnectorDescriptor | undefined {
  return DESCRIPTORS[surface];
}

// ── Spawn resolution ───────────────────────────────────────────────────────

/**
 * Resolve the subprocess command + args for `entry`.
 *
 * Resolution order:
 * 1. `entry.command` / `entry.args` (per-entry overrides from connectors.json)
 * 2. Descriptor `defaultCommand` / `defaultArgs` for the surface
 *
 * Throws if neither the entry nor a descriptor can supply a command.
 */
export function resolveSpawn(entry: ConnectorEntry): { command: string; args: string[] } {
  const desc = getDescriptor(entry.surface);
  const command = entry.command ?? desc?.defaultCommand;
  if (command === undefined) {
    throw new Error(
      `no spawn command for surface '${entry.surface}' — add a descriptor or set command in connectors.json`,
    );
  }
  const args = entry.args ?? desc?.defaultArgs ?? [];
  return { command, args };
}
