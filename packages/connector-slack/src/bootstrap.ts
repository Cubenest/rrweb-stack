/**
 * Secret-store setup helpers extracted from the main() bootstrap so they can
 * be unit-tested without a live Slack connection.
 */
import {
  type SecretStore,
  createSecretStore,
  defaultSecretPath,
  migrateLegacySecret,
  promptSecret,
} from '@peekdev/connector-core';
import type { SlackConfig } from './config.js';
import { resolveSlackTokens } from './config.js';

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

/**
 * Dependencies injected into `buildSlackConfig` (all optional for production
 * use; required overrides in tests allow unit-testing without live prompts).
 */
export interface BuildSlackConfigOptions {
  env?: NodeJS.ProcessEnv;
  isTTY?: boolean;
  prompt?: (label: string) => Promise<string>;
}

/**
 * Resolve Slack bot + app tokens using the SecretStore built by
 * `buildBootstrapStore`.
 *
 * Resolution order (per token): store → env var → interactive prompt (TTY only).
 * Captured prompt values are persisted into the store for future headless runs.
 *
 * Extracted from `main()` so the token-resolution step can be unit-tested
 * without a live Slack connection or MCP client.
 *
 * @param store  The SecretStore from `buildBootstrapStore` (must be ready).
 * @param opts   Injectable overrides for env, isTTY, and prompt function.
 * @returns      The resolved `SlackConfig` with both tokens populated.
 */
export async function buildSlackConfig(
  store: SecretStore,
  opts: BuildSlackConfigOptions = {},
): Promise<SlackConfig> {
  return resolveSlackTokens({
    store,
    env: opts.env ?? process.env,
    isTTY: opts.isTTY ?? Boolean(process.stdin.isTTY),
    prompt: opts.prompt ?? promptSecret,
  });
}
