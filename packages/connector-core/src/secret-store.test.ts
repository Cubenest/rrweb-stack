import { mkdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  FileSecretStore,
  KeychainSecretStore,
  type KeyringEntryLike,
  defaultSecretPath,
  loadPairingSecret,
  migrateLegacySecret,
  savePairingSecret,
} from './secret-store.js';

let testDir: string;

beforeEach(async () => {
  testDir = join(
    tmpdir(),
    `peek-secret-store-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  await mkdir(testDir, { recursive: true });
});

afterEach(async () => {
  await rm(testDir, { recursive: true, force: true });
});

// ---- FileSecretStore contract ----

describe('FileSecretStore', () => {
  it('set then get round-trips a secret', async () => {
    const store = new FileSecretStore({ filePath: join(testDir, 'secrets.json') });
    await store.set('slack-abc', 'pairing', 's3cr3t');
    const val = await store.get('slack-abc', 'pairing');
    expect(val).toBe('s3cr3t');
  });

  it('get on a missing key returns null', async () => {
    const store = new FileSecretStore({ filePath: join(testDir, 'secrets.json') });
    const val = await store.get('no-such-connector', 'pairing');
    expect(val).toBeNull();
  });

  it('get on a missing file returns null (no throw)', async () => {
    const store = new FileSecretStore({
      filePath: join(testDir, 'nonexistent-dir', 'secrets.json'),
    });
    const val = await store.get('any', 'pairing');
    expect(val).toBeNull();
  });

  it('get on a malformed file returns null (no throw)', async () => {
    const filePath = join(testDir, 'secrets.json');
    await writeFile(filePath, 'not json at all', { mode: 0o600 });
    const store = new FileSecretStore({ filePath });
    const val = await store.get('any', 'pairing');
    expect(val).toBeNull();
  });

  it('overwrite: second set replaces the value', async () => {
    const store = new FileSecretStore({ filePath: join(testDir, 'secrets.json') });
    await store.set('slack-abc', 'pairing', 'first');
    await store.set('slack-abc', 'pairing', 'second');
    const val = await store.get('slack-abc', 'pairing');
    expect(val).toBe('second');
  });

  it('two names under the same connectorId do not collide', async () => {
    const store = new FileSecretStore({ filePath: join(testDir, 'secrets.json') });
    await store.set('slack-abc', 'pairing', 'pairing-secret');
    await store.set('slack-abc', 'other', 'other-secret');
    expect(await store.get('slack-abc', 'pairing')).toBe('pairing-secret');
    expect(await store.get('slack-abc', 'other')).toBe('other-secret');
  });

  it('delete removes the key (subsequent get returns null)', async () => {
    const store = new FileSecretStore({ filePath: join(testDir, 'secrets.json') });
    await store.set('slack-abc', 'pairing', 's3cr3t');
    await store.delete('slack-abc', 'pairing');
    const val = await store.get('slack-abc', 'pairing');
    expect(val).toBeNull();
  });

  it('delete does not affect a sibling secret', async () => {
    const store = new FileSecretStore({ filePath: join(testDir, 'secrets.json') });
    await store.set('slack-abc', 'pairing', 'pairing-secret');
    await store.set('slack-abc', 'other', 'other-secret');
    await store.delete('slack-abc', 'pairing');
    expect(await store.get('slack-abc', 'pairing')).toBeNull();
    expect(await store.get('slack-abc', 'other')).toBe('other-secret');
  });

  it('writes the file with mode 0o600', async () => {
    if (process.platform === 'win32') return;
    const filePath = join(testDir, 'secrets.json');
    const store = new FileSecretStore({ filePath });
    await store.set('slack-abc', 'pairing', 's3cr3t');
    const info = await stat(filePath);
    expect(info.mode & 0o777).toBe(0o600);
  });

  it('creates intermediate directories automatically', async () => {
    const store = new FileSecretStore({
      filePath: join(testDir, 'a', 'b', 'c', 'secrets.json'),
    });
    await store.set('x', 'pairing', 'val');
    expect(await store.get('x', 'pairing')).toBe('val');
  });
});

// ---- migrateLegacySecret ----

describe('migrateLegacySecret', () => {
  it('imports secret from legacy file + deletes the legacy file', async () => {
    const legacyPath = join(testDir, 'pairing.json');
    await writeFile(
      legacyPath,
      JSON.stringify({ connectorId: 'slack-abc', secret: 'legacy-secret' }),
      { mode: 0o600 },
    );
    const store = new FileSecretStore({ filePath: join(testDir, 'secrets.json') });

    await migrateLegacySecret(store, 'slack-abc', legacyPath);

    expect(await store.get('slack-abc', 'pairing')).toBe('legacy-secret');
    // legacy file must be deleted
    await expect(stat(legacyPath)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('is a no-op when the legacy file does not exist', async () => {
    const legacyPath = join(testDir, 'nonexistent.json');
    const store = new FileSecretStore({ filePath: join(testDir, 'secrets.json') });

    // must not throw
    await expect(migrateLegacySecret(store, 'slack-abc', legacyPath)).resolves.toBeUndefined();
    expect(await store.get('slack-abc', 'pairing')).toBeNull();
  });

  it('does not overwrite an existing store entry', async () => {
    const legacyPath = join(testDir, 'pairing.json');
    await writeFile(
      legacyPath,
      JSON.stringify({ connectorId: 'slack-abc', secret: 'legacy-secret' }),
      { mode: 0o600 },
    );
    const store = new FileSecretStore({ filePath: join(testDir, 'secrets.json') });
    await store.set('slack-abc', 'pairing', 'existing-secret');

    await migrateLegacySecret(store, 'slack-abc', legacyPath);

    // store entry unchanged
    expect(await store.get('slack-abc', 'pairing')).toBe('existing-secret');
  });
});

// ---- legacy SP4 API still works (callers in runtime.ts use them until Task 4) ----

describe('savePairingSecret / loadPairingSecret', () => {
  it('round-trips a PairingSecret', async () => {
    const path = join(testDir, 'pairing.json');
    const secret = { connectorId: 'slack-abc', secret: 's3cr3t' };
    await savePairingSecret(path, secret);
    const loaded = await loadPairingSecret(path);
    expect(loaded).toEqual(secret);
  });

  it('creates intermediate directories automatically', async () => {
    const path = join(testDir, 'a', 'b', 'c', 'pairing.json');
    const secret = { connectorId: 'test', secret: 'val' };
    await savePairingSecret(path, secret);
    const loaded = await loadPairingSecret(path);
    expect(loaded).toEqual(secret);
  });

  it('writes the file with mode 0o600', async () => {
    const path = join(testDir, 'pairing.json');
    await savePairingSecret(path, { connectorId: 'x', secret: 'y' });
    if (process.platform !== 'win32') {
      const info = await stat(path);
      expect(info.mode & 0o777).toBe(0o600);
    }
  });
});

describe('loadPairingSecret', () => {
  it('returns null when the file does not exist', async () => {
    const path = join(testDir, 'nonexistent.json');
    const result = await loadPairingSecret(path);
    expect(result).toBeNull();
  });

  it('returns null for malformed JSON without throwing', async () => {
    const path = join(testDir, 'bad.json');
    await writeFile(path, 'not json at all', { mode: 0o600 });
    const result = await loadPairingSecret(path);
    expect(result).toBeNull();
  });

  it('returns null for JSON that is not an object with the right shape', async () => {
    const path = join(testDir, 'wrong-shape.json');
    await writeFile(path, JSON.stringify({ foo: 'bar' }), { mode: 0o600 });
    const result = await loadPairingSecret(path);
    expect(result).toBeNull();
  });
});

describe('defaultSecretPath', () => {
  it('contains peek-slack and ends with pairing.json for slack', () => {
    const p = defaultSecretPath('slack');
    expect(p).toContain('peek-slack');
    expect(p.endsWith('pairing.json')).toBe(true);
  });

  it('contains peek-discord and ends with pairing.json for discord', () => {
    const p = defaultSecretPath('discord');
    expect(p).toContain('peek-discord');
    expect(p.endsWith('pairing.json')).toBe(true);
  });
});

// ---- KeychainSecretStore contract (fake entry factory — never touches real keychain) ----

/** Build an in-memory fake keyring factory for tests. */
function makeFakeFactory(): (service: string, account: string) => KeyringEntryLike {
  const store = new Map<string, string>();
  return (service: string, account: string): KeyringEntryLike => ({
    getPassword(): string | null {
      return store.get(`${service}:${account}`) ?? null;
    },
    setPassword(p: string): void {
      store.set(`${service}:${account}`, p);
    },
    deletePassword(): boolean {
      return store.delete(`${service}:${account}`);
    },
  });
}

describe('KeychainSecretStore', () => {
  it('set calls the factory with service=peek-connector and account=connectorId:name', async () => {
    const calls: Array<{ service: string; account: string }> = [];
    const factory = (service: string, account: string): KeyringEntryLike => {
      calls.push({ service, account });
      const delegate = makeFakeFactory()(service, account);
      return delegate;
    };
    const store = new KeychainSecretStore({ entryFactory: factory });
    await store.set('slack-abc', 'pairing', 'secret-value');
    expect(calls[0]).toEqual({ service: 'peek-connector', account: 'slack-abc:pairing' });
  });

  it('set then get round-trips a secret', async () => {
    const store = new KeychainSecretStore({ entryFactory: makeFakeFactory() });
    await store.set('slack-abc', 'pairing', 'my-secret');
    const val = await store.get('slack-abc', 'pairing');
    expect(val).toBe('my-secret');
  });

  it('get on a missing account returns null (no throw)', async () => {
    const store = new KeychainSecretStore({ entryFactory: makeFakeFactory() });
    const val = await store.get('no-such-connector', 'pairing');
    expect(val).toBeNull();
  });

  it('get when factory entry throws returns null (no throw, error normalized)', async () => {
    const throwingFactory = (_service: string, _account: string): KeyringEntryLike => ({
      getPassword(): string | null {
        throw new Error('simulated keychain read error');
      },
      setPassword(_p: string): void {},
      deletePassword(): boolean {
        return false;
      },
    });
    const store = new KeychainSecretStore({ entryFactory: throwingFactory });
    const val = await store.get('any', 'pairing');
    expect(val).toBeNull();
  });

  it('delete calls deletePassword on the entry', async () => {
    const calls: string[] = [];
    const innerFactory = makeFakeFactory();
    const factory = (service: string, account: string): KeyringEntryLike => {
      const inner = innerFactory(service, account);
      return {
        getPassword: () => inner.getPassword(),
        setPassword: (p: string) => inner.setPassword(p),
        deletePassword: (): boolean | undefined => {
          calls.push('deletePassword');
          return inner.deletePassword();
        },
      };
    };
    const store = new KeychainSecretStore({ entryFactory: factory });
    await store.set('slack-abc', 'pairing', 'some-secret');
    await store.delete('slack-abc', 'pairing');
    expect(calls).toContain('deletePassword');
  });

  it('delete removes the key (subsequent get returns null)', async () => {
    const store = new KeychainSecretStore({ entryFactory: makeFakeFactory() });
    await store.set('slack-abc', 'pairing', 'some-secret');
    await store.delete('slack-abc', 'pairing');
    const val = await store.get('slack-abc', 'pairing');
    expect(val).toBeNull();
  });

  it('delete on a missing key does not throw', async () => {
    const store = new KeychainSecretStore({ entryFactory: makeFakeFactory() });
    await expect(store.delete('no-such', 'pairing')).resolves.toBeUndefined();
  });
});

describe('KeychainSecretStore.isAvailable', () => {
  it('returns true when the factory works', async () => {
    const result = await KeychainSecretStore.isAvailable(makeFakeFactory());
    expect(result).toBe(true);
  });

  it('returns false when the factory throws on construction', async () => {
    const brokenFactory = (_service: string, _account: string): KeyringEntryLike => {
      throw new Error('native load failed');
    };
    const result = await KeychainSecretStore.isAvailable(brokenFactory);
    expect(result).toBe(false);
  });

  it('returns false when getPassword throws during the probe', async () => {
    const probingFactory = (_service: string, _account: string): KeyringEntryLike => ({
      getPassword(): string | null {
        throw new Error('no libsecret backend');
      },
      setPassword(_p: string): void {},
      deletePassword(): boolean {
        return false;
      },
    });
    const result = await KeychainSecretStore.isAvailable(probingFactory);
    expect(result).toBe(false);
  });

  it('does not throw even when the factory is broken', async () => {
    const brokenFactory = (): KeyringEntryLike => {
      throw new Error('boom');
    };
    await expect(KeychainSecretStore.isAvailable(brokenFactory)).resolves.toBeDefined();
  });
});
