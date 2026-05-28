import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { EMPTY_POLICY, loadPolicy, parsePolicy } from '../src/native-host/policy.js';

let workdir: string;

beforeEach(() => {
  workdir = mkdtempSync(join(tmpdir(), 'peek-policy-'));
});
afterEach(() => {
  rmSync(workdir, { recursive: true, force: true });
});

describe('parsePolicy', () => {
  it('returns EMPTY_POLICY for non-JSON contents', () => {
    expect(parsePolicy('not json')).toEqual(EMPTY_POLICY);
  });

  it('returns EMPTY_POLICY for a JSON value that fails the schema', () => {
    expect(parsePolicy('42')).toEqual(EMPTY_POLICY);
    expect(parsePolicy('"plain string"')).toEqual(EMPTY_POLICY);
    expect(parsePolicy('[]')).toEqual(EMPTY_POLICY);
  });

  it('parses the P2 PRD §E.3 example', () => {
    const out = parsePolicy(
      JSON.stringify({
        destructiveTerms: { add: ['yeet', 'nuke'], remove: [] },
        allowListBySite: { 'https://example.com/*': ['click', 'type'] },
      }),
    );
    expect(out.destructiveTerms.add).toEqual(['yeet', 'nuke']);
    expect(out.destructiveTerms.remove).toEqual([]);
    expect(out.allowListBySite).toEqual({ 'https://example.com/*': ['click', 'type'] });
  });

  it('normalises destructive terms: trim + lowercase + dedupe + drop empty', () => {
    const out = parsePolicy(
      JSON.stringify({
        destructiveTerms: { add: ['  YEET ', 'yeet', '', '   ', 'Nuke'] },
      }),
    );
    expect(out.destructiveTerms.add).toEqual(['yeet', 'nuke']);
  });

  it('drops non-string array entries silently', () => {
    const out = parsePolicy(
      JSON.stringify({
        destructiveTerms: { remove: ['confirm', 42, null, true] },
      }),
    );
    expect(out.destructiveTerms.remove).toEqual(['confirm']);
  });

  it('drops malformed allowListBySite entries', () => {
    const out = parsePolicy(
      JSON.stringify({
        allowListBySite: {
          'https://good.com/*': ['click'],
          '': ['ignored'], // empty origin → dropped
          'https://bad.com/*': 'not-an-array', // dropped at schema layer
        },
      }),
    );
    expect(out.allowListBySite).toEqual({ 'https://good.com/*': ['click'] });
  });
});

describe('loadPolicy', () => {
  it('returns EMPTY_POLICY when the file does not exist', () => {
    expect(loadPolicy(join(workdir, 'nope.json'))).toEqual(EMPTY_POLICY);
  });

  it('returns EMPTY_POLICY when the file is unreadable JSON', () => {
    const path = join(workdir, 'policy.json');
    writeFileSync(path, '{ broken', 'utf8');
    expect(loadPolicy(path)).toEqual(EMPTY_POLICY);
  });

  it('round-trips a written policy', () => {
    const path = join(workdir, 'policy.json');
    writeFileSync(
      path,
      JSON.stringify({
        destructiveTerms: { add: ['nuke'], remove: ['confirm'] },
      }),
      'utf8',
    );
    const loaded = loadPolicy(path);
    expect(loaded.destructiveTerms.add).toEqual(['nuke']);
    expect(loaded.destructiveTerms.remove).toEqual(['confirm']);
  });
});
