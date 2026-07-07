import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

// ---- SP4 legacy types + helpers (still consumed by runtime.ts until Task 4) ----

export interface PairingSecret {
  connectorId: string;
  secret: string;
}

function isPairingSecret(value: unknown): value is PairingSecret {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as Record<string, unknown>).connectorId === 'string' &&
    typeof (value as Record<string, unknown>).secret === 'string'
  );
}

/**
 * Read and parse a previously saved PairingSecret.
 * Returns null on ENOENT or malformed/invalid JSON — never throws.
 */
export async function loadPairingSecret(path: string): Promise<PairingSecret | null> {
  let raw: string;
  try {
    raw = await readFile(path, 'utf-8');
  } catch {
    return null;
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    return isPairingSecret(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * Persist a PairingSecret to disk with mode 0600.
 * Creates intermediate directories as needed.
 */
export async function savePairingSecret(path: string, value: PairingSecret): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(value), { mode: 0o600 });
}

/**
 * Returns the default path for a connector's legacy pairing secret.
 * e.g. ~/.config/peek-slack/pairing.json
 * Used by migrateLegacySecret and Task 5 bootstrap.
 */
export function defaultSecretPath(connectorName: string): string {
  return join(homedir(), '.config', `peek-${connectorName}`, 'pairing.json');
}

// ---- SP6a: SecretStore interface + FileSecretStore + migration helper ----

/**
 * Pluggable secret storage. Implementations must be safe to use concurrently
 * (read-modify-write) — callers do not hold external locks.
 */
export interface SecretStore {
  /** Returns the secret for (connectorId, name), or null if absent. */
  get(connectorId: string, name: string): Promise<string | null>;
  /** Stores the secret for (connectorId, name). */
  set(connectorId: string, name: string, secret: string): Promise<void>;
  /** Removes the secret for (connectorId, name). No-op if absent. */
  delete(connectorId: string, name: string): Promise<void>;
}

/**
 * A single keyed 0600 JSON file storing all connector secrets as a flat map
 * keyed by `"${connectorId}:${name}"`.
 *
 * Default location: ~/.config/peek/connectors/secrets.json
 */
export class FileSecretStore implements SecretStore {
  readonly #filePath: string;

  constructor(opts?: { filePath?: string }) {
    this.#filePath =
      opts?.filePath ?? join(homedir(), '.config', 'peek', 'connectors', 'secrets.json');
  }

  /** Read all secrets from disk. Returns {} on ENOENT or malformed JSON — never throws. */
  async #readAll(): Promise<Record<string, string>> {
    let raw: string;
    try {
      raw = await readFile(this.#filePath, 'utf-8');
    } catch {
      return {};
    }
    try {
      const parsed: unknown = JSON.parse(raw);
      if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
        return parsed as Record<string, string>;
      }
      return {};
    } catch {
      return {};
    }
  }

  /** Write the full secrets map to disk with mode 0600. Creates dirs as needed. */
  async #writeAll(map: Record<string, string>): Promise<void> {
    await mkdir(dirname(this.#filePath), { recursive: true });
    await writeFile(this.#filePath, JSON.stringify(map), { mode: 0o600 });
  }

  async get(connectorId: string, name: string): Promise<string | null> {
    const map = await this.#readAll();
    return map[`${connectorId}:${name}`] ?? null;
  }

  async set(connectorId: string, name: string, secret: string): Promise<void> {
    const map = await this.#readAll();
    map[`${connectorId}:${name}`] = secret;
    await this.#writeAll(map);
  }

  async delete(connectorId: string, name: string): Promise<void> {
    const map = await this.#readAll();
    const key = `${connectorId}:${name}`;
    const { [key]: _omit, ...rest } = map;
    await this.#writeAll(rest);
  }
}

/**
 * Best-effort migration from the SP4 per-connector pairing.json to the new
 * FileSecretStore. If the store already has the secret, no-op. Otherwise reads
 * the legacy file, imports the secret, and removes the legacy file. All errors
 * are swallowed — callers must not depend on this succeeding.
 */
export async function migrateLegacySecret(
  store: SecretStore,
  connectorId: string,
  legacyPath: string,
): Promise<void> {
  try {
    if (await store.get(connectorId, 'pairing')) return;
    const legacy = await loadPairingSecret(legacyPath);
    if (legacy) {
      await store.set(connectorId, 'pairing', legacy.secret);
      await rm(legacyPath, { force: true });
    }
  } catch {
    // best-effort — swallow all errors
  }
}
