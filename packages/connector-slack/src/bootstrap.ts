/**
 * Secret-store setup helpers extracted from the main() bootstrap so they can
 * be unit-tested without a live Slack connection.
 */
import {
  type SecretStore,
  createSecretStore,
  defaultSecretPath,
  migrateLegacySecret,
} from '@peekdev/connector-core';

/**
 * Injectable overrides forwarded to `createSecretStore`.
 * Mirrors the relevant subset of CreateSecretStoreOptions from connector-core
 * so callers can drive the backend selection in tests without touching the
 * real keychain or filesystem.
 */
export interface BuildBootstrapStoreOptions {
  /** Pass true to skip the keychain probe and always use the file store. */
  insecureStore?: boolean;
  /** Override keychain availability probe (useful in tests). */
  keychainAvailable?: () => Promise<boolean>;
  /** Override keychain store construction (useful in tests). */
  makeKeychain?: () => SecretStore;
  /** Override file store construction (useful in tests). */
  makeFile?: () => SecretStore;
  /** Override the warning emitter (useful in tests). */
  warn?: (msg: string) => void;
}

/**
 * Build the SecretStore for the peek-slack connector bootstrap.
 *
 * Calls `createSecretStore` to pick the best available backend (keychain or
 * file), then runs `migrateLegacySecret` to silently import any SP4-era
 * `~/.config/peek-slack/pairing.json` into the new store.
 *
 * @param opts  Optional overrides forwarded to `createSecretStore`.
 * @returns     The ready-to-use SecretStore.
 */
export async function buildBootstrapStore(
  opts: BuildBootstrapStoreOptions = {},
): Promise<SecretStore> {
  const store = await createSecretStore(opts);
  await migrateLegacySecret(store, 'peek-slack', defaultSecretPath('slack'));
  return store;
}

/**
 * Determine whether the connector is already paired by checking the store.
 *
 * @param store        The SecretStore built by `buildBootstrapStore`.
 * @param connectorId  The connector client name (`'peek-slack'`).
 * @returns            `true` when a pairing secret exists, `false` otherwise.
 */
export async function resolvePairedState(
  store: SecretStore,
  connectorId: string,
): Promise<boolean> {
  return (await store.get(connectorId, 'pairing')) !== null;
}
