import { mkdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { defaultSecretPath, loadPairingSecret, savePairingSecret } from './secret-store.js';

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
