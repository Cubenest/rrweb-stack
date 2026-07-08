// status.json read/write for `peek connect` — shared between the supervisor
// daemon and the `peek connect status` command verb.
//
// The file lives at `~/.peek/connect/status.json` and is written atomically
// via `atomicWriteFileSync` so a partial write never leaves a malformed file.
// All reads are null-safe (try/catch + shape guard) and return `{}` on any
// error so the status command degrades gracefully when the daemon has never run.

import { mkdirSync } from 'node:fs';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { atomicWriteFileSync } from '../fs-atomic.js';
import { peekHomeDir } from '../peek-home.js';
import type { ConnectorStatus } from './supervisor.js';

// ── Injectable deps ────────────────────────────────────────────────────────

export interface StatusDeps {
  /** Override for `readFileSync(path, 'utf8')`. */
  readFile?: (path: string) => string;
  /** Override for `mkdirSync(path, { recursive: true })`. */
  mkdirSync?: (path: string) => void;
  /** Override for `atomicWriteFileSync(path, content)`. */
  atomicWrite?: (path: string, content: string) => void;
}

// ── statusPath ─────────────────────────────────────────────────────────────

/** Absolute path to the connector status file: `~/.peek/connect/status.json`. */
export function statusPath(): string {
  return join(peekHomeDir(), 'connect', 'status.json');
}

// ── readStatus ─────────────────────────────────────────────────────────────

/**
 * Read and parse `~/.peek/connect/status.json`.
 *
 * Returns an empty record on any error — absent file, malformed JSON, or
 * unexpected shape. Never throws.
 */
export function readStatus(deps?: StatusDeps): Record<string, ConnectorStatus> {
  const fsRead = deps?.readFile ?? ((p: string) => readFileSync(p, 'utf8'));

  let raw: string;
  try {
    raw = fsRead(statusPath());
  } catch {
    return {};
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return {};
  }

  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return {};
  }

  // Shape-guard each entry: must have a `state` field of the expected union.
  const validStates = new Set<string>(['running', 'backing-off', 'stopped']);
  const result: Record<string, ConnectorStatus> = {};

  for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
    if (
      value === null ||
      typeof value !== 'object' ||
      !('state' in value) ||
      !('restarts' in value) ||
      typeof (value as Record<string, unknown>).restarts !== 'number'
    ) {
      continue;
    }
    const state = (value as Record<string, unknown>).state;
    if (typeof state !== 'string' || !validStates.has(state)) {
      continue;
    }

    // Validate optional numeric fields before including them. Drop any field
    // whose value is present but not a number (malformed JSON) to satisfy
    // exactOptionalPropertyTypes — use conditional-spread, never assign undefined.
    const v = value as Record<string, unknown>;
    const entry: ConnectorStatus = {
      state: state as ConnectorStatus['state'],
      restarts: v.restarts as number,
      ...(typeof v.pid === 'number' ? { pid: v.pid } : {}),
      ...(typeof v.lastExitCode === 'number' ? { lastExitCode: v.lastExitCode } : {}),
      ...(typeof v.nextRetryAtMs === 'number' ? { nextRetryAtMs: v.nextRetryAtMs } : {}),
    };
    result[key] = entry;
  }

  return result;
}

// ── writeStatus ────────────────────────────────────────────────────────────

/**
 * Persist a full status snapshot to `~/.peek/connect/status.json` atomically.
 *
 * Creates the parent `connect/` directory if it does not exist.
 * All file-system operations are injectable for tests.
 */
export function writeStatus(status: Record<string, ConnectorStatus>, deps?: StatusDeps): void {
  const path = statusPath();
  const mkdir = deps?.mkdirSync ?? ((p: string) => mkdirSync(p, { recursive: true }));
  const write =
    deps?.atomicWrite ?? ((p: string, content: string) => atomicWriteFileSync(p, content));

  mkdir(dirname(path));
  write(path, JSON.stringify(status, null, 2));
}
