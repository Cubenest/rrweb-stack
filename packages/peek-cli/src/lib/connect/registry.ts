// Registry for `peek connect` connectors — persisted to
// ~/.peek/connect/connectors.json (ADR layout extension for SP6b-2).
// All reads are fault-tolerant (ENOENT / malformed JSON / zod-invalid →
// { connectors: {} }, never throws). All writes go through atomicWriteFileSync.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import { atomicWriteFileSync } from '../fs-atomic.js';
import { peekHomeDir } from '../peek-home.js';

// ── Public interfaces ──────────────────────────────────────────────────────

export interface ConnectorEntry {
  surface: string;
  enabled: boolean;
  command?: string;
  args?: string[];
}

export interface ConnectorsFile {
  connectors: Record<string, ConnectorEntry>;
}

// ── Zod schema ─────────────────────────────────────────────────────────────

const connectorEntrySchema = z.object({
  surface: z.string(),
  enabled: z.boolean(),
  command: z.string().optional(),
  args: z.array(z.string()).optional(),
});

const connectorsFileSchema = z.object({
  connectors: z.record(z.string(), connectorEntrySchema),
});

// ── Path helper ────────────────────────────────────────────────────────────

/** Default path: `~/.peek/connect/connectors.json`. */
export function connectorsPath(): string {
  return join(peekHomeDir(), 'connect', 'connectors.json');
}

// ── Read ───────────────────────────────────────────────────────────────────

/**
 * Read and parse connectors.json from `path` (defaults to
 * {@link connectorsPath}). Malformed JSON, ENOENT, and zod-invalid content all
 * return `{ connectors: {} }` without throwing.
 *
 * Every failure path returns a FRESH object so callers that mutate the result
 * cannot corrupt a shared sentinel reference.
 */
export function readConnectors(path?: string): ConnectorsFile {
  const target = path ?? connectorsPath();
  let rawText: string;
  try {
    rawText = readFileSync(target, 'utf8');
  } catch {
    return { connectors: {} };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawText);
  } catch {
    return { connectors: {} };
  }
  const result = connectorsFileSchema.safeParse(parsed);
  if (!result.success) return { connectors: {} };
  // Re-map each entry so optional fields are absent (not `undefined`) to satisfy
  // `exactOptionalPropertyTypes` — zod's `.optional()` produces `T | undefined`
  // which is incompatible with the interface's `field?: T` under that flag.
  const connectors: Record<string, ConnectorEntry> = {};
  for (const [name, rawEntry] of Object.entries(result.data.connectors)) {
    const entry: ConnectorEntry = { surface: rawEntry.surface, enabled: rawEntry.enabled };
    if (rawEntry.command !== undefined) entry.command = rawEntry.command;
    if (rawEntry.args !== undefined) entry.args = rawEntry.args;
    connectors[name] = entry;
  }
  return { connectors };
}

// ── Write ──────────────────────────────────────────────────────────────────

/**
 * Persist `file` to `path` (defaults to {@link connectorsPath}) atomically via
 * {@link atomicWriteFileSync} — parent directories are created if absent.
 */
export function writeConnectors(file: ConnectorsFile, path?: string): void {
  atomicWriteFileSync(path ?? connectorsPath(), JSON.stringify(file, null, 2));
}

// ── CRUD helpers ───────────────────────────────────────────────────────────

/**
 * Add or replace `name` in the registry and persist. Returns the updated file.
 */
export function addConnector(name: string, entry: ConnectorEntry, path?: string): ConnectorsFile {
  const current = readConnectors(path);
  const updated: ConnectorsFile = {
    connectors: { ...current.connectors, [name]: entry },
  };
  writeConnectors(updated, path);
  return updated;
}

/**
 * Remove `name` from the registry (spread-omit, NOT the `delete` operator)
 * and persist. Returns the updated file. No-op if `name` is absent.
 */
export function removeConnector(name: string, path?: string): ConnectorsFile {
  const current = readConnectors(path);
  const { [name]: _omit, ...rest } = current.connectors;
  const updated: ConnectorsFile = { connectors: rest };
  writeConnectors(updated, path);
  return updated;
}
