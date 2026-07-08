import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { addConnector, readConnectors, removeConnector, writeConnectors } from './registry.js';

let tmpDir: string;
let registryPath: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'peek-registry-'));
  registryPath = join(tmpDir, 'connectors.json');
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

describe('readConnectors', () => {
  it('returns empty connectors when file does not exist', () => {
    const result = readConnectors(registryPath);
    expect(result).toEqual({ connectors: {} });
  });

  it('parses a valid connectors file', () => {
    const valid = {
      connectors: {
        'peek-slack': { surface: 'slack', enabled: true },
      },
    };
    writeFileSync(registryPath, JSON.stringify(valid));
    const result = readConnectors(registryPath);
    expect(result).toEqual(valid);
  });

  it('returns empty connectors for malformed JSON (no throw)', () => {
    writeFileSync(registryPath, '{ not valid json !!!');
    const result = readConnectors(registryPath);
    expect(result).toEqual({ connectors: {} });
  });

  it('returns empty connectors for zod-invalid shape (no throw)', () => {
    // enabled is a string instead of boolean — zod-invalid
    writeFileSync(
      registryPath,
      JSON.stringify({ connectors: { 'bad-entry': { surface: 'slack', enabled: 'yes' } } }),
    );
    const result = readConnectors(registryPath);
    expect(result).toEqual({ connectors: {} });
  });

  it('parses an entry with optional command and args fields', () => {
    const withOpts = {
      connectors: {
        'peek-teams': {
          surface: 'teams',
          enabled: false,
          command: '/usr/local/bin/teams-bridge',
          args: ['--token', 'abc'],
        },
      },
    };
    writeFileSync(registryPath, JSON.stringify(withOpts));
    expect(readConnectors(registryPath)).toEqual(withOpts);
  });

  it('returns a fresh object on each failure call — no shared sentinel', () => {
    // ENOENT path: two calls must return distinct object references
    const a = readConnectors(registryPath);
    const b = readConnectors(registryPath);
    expect(a).not.toBe(b);
    expect(a.connectors).not.toBe(b.connectors);
  });
});

describe('writeConnectors', () => {
  it('writes the file and can be read back', () => {
    const file = {
      connectors: {
        'peek-slack': { surface: 'slack', enabled: true },
      },
    };
    writeConnectors(file, registryPath);
    expect(readConnectors(registryPath)).toEqual(file);
  });

  it('creates parent directories if they do not exist', () => {
    const nested = join(tmpDir, 'a', 'b', 'c', 'connectors.json');
    const file = { connectors: {} };
    writeConnectors(file, nested);
    expect(readConnectors(nested)).toEqual(file);
  });
});

describe('addConnector', () => {
  it('adds a connector and round-trips through readConnectors', () => {
    const result = addConnector('peek-slack', { surface: 'slack', enabled: true }, registryPath);
    expect(result.connectors['peek-slack']).toEqual({ surface: 'slack', enabled: true });
    // Persisted on disk
    expect(readConnectors(registryPath).connectors['peek-slack']).toEqual({
      surface: 'slack',
      enabled: true,
    });
  });

  it('overwrites an existing connector with the same name', () => {
    addConnector('peek-slack', { surface: 'slack', enabled: true }, registryPath);
    const result = addConnector('peek-slack', { surface: 'slack', enabled: false }, registryPath);
    expect(result.connectors['peek-slack']?.enabled).toBe(false);
  });

  it('two connectors coexist', () => {
    addConnector('peek-slack', { surface: 'slack', enabled: true }, registryPath);
    addConnector('peek-discord', { surface: 'discord', enabled: false }, registryPath);
    const file = readConnectors(registryPath);
    expect(Object.keys(file.connectors)).toHaveLength(2);
    expect(file.connectors['peek-slack']?.surface).toBe('slack');
    expect(file.connectors['peek-discord']?.surface).toBe('discord');
  });
});

describe('removeConnector', () => {
  it('removes only the named connector, leaving others intact', () => {
    addConnector('peek-slack', { surface: 'slack', enabled: true }, registryPath);
    addConnector('peek-discord', { surface: 'discord', enabled: false }, registryPath);

    const result = removeConnector('peek-slack', registryPath);
    expect(result.connectors['peek-slack']).toBeUndefined();
    expect(result.connectors['peek-discord']).toBeDefined();
    // Also persisted
    const onDisk = readConnectors(registryPath);
    expect(onDisk.connectors['peek-slack']).toBeUndefined();
    expect(onDisk.connectors['peek-discord']).toBeDefined();
  });

  it('is a no-op when the connector does not exist', () => {
    addConnector('peek-slack', { surface: 'slack', enabled: true }, registryPath);
    const result = removeConnector('peek-nonexistent', registryPath);
    expect(result.connectors['peek-slack']).toBeDefined();
  });
});
