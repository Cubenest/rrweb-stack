import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadExtensionIds } from '../src/native-host/config.js';

describe('loadExtensionIds — zod validation', () => {
  let dir: string;
  const write = (name: string, contents: string): string => {
    const p = join(dir, name);
    writeFileSync(p, contents, 'utf8');
    return p;
  };

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'peek-ids-'));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('parses a well-formed file (ignoring unknown keys like $comment)', () => {
    const p = write(
      'ids.json',
      JSON.stringify({ $comment: 'note', chromeWebStore: 'abc', edgeAddons: 'def', dev: 'ghi' }),
    );
    expect(loadExtensionIds(p)).toEqual({ chromeWebStore: 'abc', edgeAddons: 'def', dev: 'ghi' });
  });

  it('defaults missing keys to empty strings', () => {
    const p = write('ids.json', JSON.stringify({ chromeWebStore: 'abc' }));
    expect(loadExtensionIds(p)).toEqual({ chromeWebStore: 'abc', edgeAddons: '', dev: '' });
  });

  it('throws loudly on a non-string id value (corruption is not masked)', () => {
    const p = write('ids.json', JSON.stringify({ chromeWebStore: 123, edgeAddons: 'x', dev: 'y' }));
    expect(() => loadExtensionIds(p)).toThrow(/invalid extension-ids\.json/);
  });

  it('throws loudly on unparseable JSON', () => {
    const p = write('ids.json', '{ not json');
    expect(() => loadExtensionIds(p)).toThrow(/failed to read extension-ids\.json/);
  });

  it('throws loudly when the file is missing', () => {
    expect(() => loadExtensionIds(join(dir, 'does-not-exist.json'))).toThrow(
      /failed to read extension-ids\.json/,
    );
  });
});
