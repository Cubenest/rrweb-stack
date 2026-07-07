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

// ---- SP6a: SecretStore interface + FileSecretStore + KeychainSecretStore + migration helper ----

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

// ---- KeychainSecretStore ----

/** Minimal shape of a synchronous keyring entry — mirrors @napi-rs/keyring's Entry. */
export interface KeyringEntryLike {
  getPassword(): string | null;
  setPassword(p: string): void;
  deletePassword(): boolean | undefined;
}

/** Factory that produces a KeyringEntryLike for a given (service, account) pair. */
export type KeyringEntryFactory = (service: string, account: string) => KeyringEntryLike;

const KEYCHAIN_SERVICE = 'peek-connector';
const PROBE_ACCOUNT = '__peek_probe__:__probe__';

/**
 * SecretStore backed by the OS keychain via @napi-rs/keyring.
 *
 * The native module is lazy-loaded on first use so the package can be
 * imported in environments where the native binary is absent (the caller
 * should probe with isAvailable() first).
 *
 * An optional entryFactory can be injected at construction for testing;
 * production code leaves it undefined and gets the real Entry class.
 */
export class KeychainSecretStore implements SecretStore {
  readonly #entryFactory: KeyringEntryFactory | undefined;
  #resolvedFactory: KeyringEntryFactory | undefined;

  constructor(opts?: { entryFactory?: KeyringEntryFactory }) {
    this.#entryFactory = opts?.entryFactory;
  }

  /** Resolve the entry factory: use the injected one or lazy-load the native module. */
  async #factory(): Promise<KeyringEntryFactory> {
    if (this.#resolvedFactory) return this.#resolvedFactory;
    if (this.#entryFactory) {
      this.#resolvedFactory = this.#entryFactory;
      return this.#resolvedFactory;
    }
    // Lazy-load the native module so the import does not fail at startup on
    // platforms where the native binary is absent.
    const { Entry } = await import('@napi-rs/keyring');
    this.#resolvedFactory = (service, account) => new Entry(service, account);
    return this.#resolvedFactory;
  }

  /** Build an entry for the given (connectorId, name) pair. */
  async #entry(connectorId: string, name: string): Promise<KeyringEntryLike> {
    const factory = await this.#factory();
    return factory(KEYCHAIN_SERVICE, `${connectorId}:${name}`);
  }

  /**
   * Returns the stored secret, or null if absent.
   *
   * Design: any error from getPassword() — whether the credential is missing
   * or the keychain backend is unavailable — is normalized to null. A missing
   * secret and a backend hiccup both mean "no usable secret"; the upstream
   * caller falls back to requesting the secret via the elicitation banner.
   */
  async get(connectorId: string, name: string): Promise<string | null> {
    try {
      const entry = await this.#entry(connectorId, name);
      return entry.getPassword();
    } catch {
      return null;
    }
  }

  async set(connectorId: string, name: string, secret: string): Promise<void> {
    const entry = await this.#entry(connectorId, name);
    entry.setPassword(secret);
  }

  async delete(connectorId: string, name: string): Promise<void> {
    try {
      const entry = await this.#entry(connectorId, name);
      entry.deletePassword();
    } catch {
      // "not found" on delete is a no-op
    }
  }

  /**
   * Probes whether the OS keychain is available and the native module can be
   * loaded. Returns false on any error (missing native binary, no libsecret
   * backend, etc.) — callers should fall back to FileSecretStore.
   *
   * An optional entryFactory can be provided for testing; production code
   * leaves it undefined to exercise the real lazy-load path.
   */
  static async isAvailable(entryFactory?: KeyringEntryFactory): Promise<boolean> {
    try {
      let factory: KeyringEntryFactory;
      if (entryFactory) {
        factory = entryFactory;
      } else {
        const { Entry } = await import('@napi-rs/keyring');
        factory = (service, account) => new Entry(service, account);
      }
      const entry = factory(KEYCHAIN_SERVICE, PROBE_ACCOUNT);
      // A benign read — result is irrelevant, null or a string both mean "backend accessible"
      entry.getPassword();
      return true;
    } catch {
      return false;
    }
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
