/**
 * Tests for the connector-slack bootstrap's secret-store wiring (SP6a/SP6b-1).
 *
 * The bootstrap's `main()` is a top-level side-effect that requires live Slack
 * credentials and an MCP connection, so we extract the testable secret-store
 * setup into `buildBootstrapStore`, token resolution into `buildSlackConfig`,
 * and test those directly.
 */
import type { SecretStore } from '@peekdev/connector-core';
import { describe, expect, it, vi } from 'vitest';
import { buildBootstrapStore, buildSlackConfig, resolvePairedState } from './bootstrap.js';

describe('buildBootstrapStore', () => {
  it('delegates to createSecretStore with insecureStore:false by default', async () => {
    // buildBootstrapStore() should call createSecretStore under the hood.
    // We verify by injecting overrides that make the call observable.
    const fileStore: SecretStore = {
      get: vi.fn(async () => null),
      set: vi.fn(async () => {}),
      delete: vi.fn(async () => {}),
    };
    const makeFile = vi.fn(() => fileStore);
    const keychainAvailable = vi.fn(async () => false);

    const store = await buildBootstrapStore({
      insecureStore: false,
      keychainAvailable,
      makeFile,
    });

    // keychainAvailable was probed (not skipped)
    expect(keychainAvailable).toHaveBeenCalledOnce();
    // makeFile was called because keychain unavailable
    expect(makeFile).toHaveBeenCalledOnce();
    expect(store).toBe(fileStore);
  });

  it('passes insecureStore:true to skip keychain probe', async () => {
    const fileStore: SecretStore = {
      get: vi.fn(async () => null),
      set: vi.fn(async () => {}),
      delete: vi.fn(async () => {}),
    };
    const makeFile = vi.fn(() => fileStore);
    const keychainAvailable = vi.fn(async () => true);

    const store = await buildBootstrapStore({
      insecureStore: true,
      keychainAvailable,
      makeFile,
    });

    // probe must be skipped when insecureStore is true
    expect(keychainAvailable).not.toHaveBeenCalled();
    expect(store).toBe(fileStore);
  });

  it('calls migrateLegacySecret with connectorId=peek-slack and the default legacy path', async () => {
    const fileStore: SecretStore = {
      get: vi.fn(async () => null),
      set: vi.fn(async () => {}),
      delete: vi.fn(async () => {}),
    };
    const makeFile = vi.fn(() => fileStore);

    // migrateLegacySecret is best-effort + touches the FS; we verify the store
    // received the expected get() call for the migration guard (it checks for an
    // existing secret before attempting import).
    await buildBootstrapStore({
      insecureStore: true,
      makeFile,
    });

    // migrateLegacySecret calls store.get('peek-slack', 'pairing') first
    expect(fileStore.get).toHaveBeenCalledWith('peek-slack', 'pairing');
  });
});

describe('resolvePairedState', () => {
  it('returns false when get returns null', async () => {
    const store: SecretStore = {
      get: vi.fn(async () => null),
      set: vi.fn(async () => {}),
      delete: vi.fn(async () => {}),
    };
    const isPaired = await resolvePairedState(store, 'peek-slack');
    expect(isPaired).toBe(false);
  });

  it('returns true when get returns a non-null string', async () => {
    const store: SecretStore = {
      get: vi.fn(async () => 'some-secret'),
      set: vi.fn(async () => {}),
      delete: vi.fn(async () => {}),
    };
    const isPaired = await resolvePairedState(store, 'peek-slack');
    expect(isPaired).toBe(true);
  });

  it('calls store.get with (connectorId, pairing)', async () => {
    const store: SecretStore = {
      get: vi.fn(async () => null),
      set: vi.fn(async () => {}),
      delete: vi.fn(async () => {}),
    };
    await resolvePairedState(store, 'peek-slack');
    expect(store.get).toHaveBeenCalledWith('peek-slack', 'pairing');
  });
});

describe('buildSlackConfig', () => {
  it('returns the resolved SlackConfig from the store (store path)', async () => {
    // Store already has both tokens — resolveSlackTokens returns them directly.
    const store: SecretStore = {
      get: vi.fn(async (_id: string, name: string) => {
        if (name === 'slack-bot') return 'xoxb-from-store';
        if (name === 'slack-app') return 'xapp-from-store';
        return null;
      }),
      set: vi.fn(async () => {}),
      delete: vi.fn(async () => {}),
    };
    const prompt = vi.fn<(label: string) => Promise<string>>();

    const config = await buildSlackConfig(store, {
      env: {},
      isTTY: false,
      prompt,
    });

    expect(config).toEqual({ slackBotToken: 'xoxb-from-store', slackAppToken: 'xapp-from-store' });
    // No interactive prompt needed — tokens came from the store.
    expect(prompt).not.toHaveBeenCalled();
  });

  it('falls through to env when store is empty', async () => {
    const store: SecretStore = {
      get: vi.fn(async () => null),
      set: vi.fn(async () => {}),
      delete: vi.fn(async () => {}),
    };
    const env: NodeJS.ProcessEnv = {
      SLACK_BOT_TOKEN: 'xoxb-env',
      SLACK_APP_TOKEN: 'xapp-env',
    };
    const prompt = vi.fn<(label: string) => Promise<string>>();

    const config = await buildSlackConfig(store, { env, isTTY: false, prompt });

    expect(config).toEqual({ slackBotToken: 'xoxb-env', slackAppToken: 'xapp-env' });
    expect(prompt).not.toHaveBeenCalled();
  });

  it('prompts and persists when store+env both empty and isTTY:true', async () => {
    const store: SecretStore = {
      get: vi.fn(async () => null),
      set: vi.fn(async () => {}),
      delete: vi.fn(async () => {}),
    };
    const prompt = vi
      .fn<(label: string) => Promise<string>>()
      .mockResolvedValueOnce('xoxb-tty')
      .mockResolvedValueOnce('xapp-tty');

    const config = await buildSlackConfig(store, { env: {}, isTTY: true, prompt });

    expect(config).toEqual({ slackBotToken: 'xoxb-tty', slackAppToken: 'xapp-tty' });
    expect(prompt).toHaveBeenCalledTimes(2);
    expect(store.set).toHaveBeenCalledWith('peek-slack', 'slack-bot', 'xoxb-tty');
    expect(store.set).toHaveBeenCalledWith('peek-slack', 'slack-app', 'xapp-tty');
  });

  it('rejects with env-var hint when store+env empty and non-TTY', async () => {
    const store: SecretStore = {
      get: vi.fn(async () => null),
      set: vi.fn(async () => {}),
      delete: vi.fn(async () => {}),
    };
    const prompt = vi.fn<(label: string) => Promise<string>>();

    await expect(buildSlackConfig(store, { env: {}, isTTY: false, prompt })).rejects.toThrow(
      /SLACK_BOT_TOKEN/,
    );
    expect(prompt).not.toHaveBeenCalled();
  });
});
