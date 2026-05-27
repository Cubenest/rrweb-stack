import { existsSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { eventWithTime } from '@cubenest/rrweb-core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { reportFileName, slugify, writeReport } from '../src/report-writer';

describe('slugify', () => {
  it('lowercases and collapses non-alphanumerics to single dashes', () => {
    expect(slugify('Logs In With Valid Credentials!')).toBe('logs-in-with-valid-credentials');
  });

  it('trims leading/trailing dashes', () => {
    expect(slugify('  --weird/title--  ')).toBe('weird-title');
  });

  it('falls back to "report" for an all-symbol title', () => {
    expect(slugify('***')).toBe('report');
  });

  it('caps length at 120 chars', () => {
    expect(slugify('a'.repeat(300)).length).toBe(120);
  });
});

describe('reportFileName', () => {
  it('combines spec + title + cid and ends in .html', () => {
    const name = reportFileName(
      { title: 'logs in', status: 'failed', spec: 'test/login.spec.ts' },
      '0-1',
    );
    expect(name).toMatch(/^test-login--logs-in--0-1-\d+\.html$/);
  });

  it('omits the cid segment when no cid is given', () => {
    const name = reportFileName({ title: 'a test', status: 'failed', spec: 'b.ts' });
    expect(name).toMatch(/^b--a-test--\d+\.html$/);
  });

  it('uses a "spec" placeholder when no spec path is present', () => {
    const name = reportFileName({ title: 'x', status: 'failed' });
    expect(name).toMatch(/^spec--x--\d+\.html$/);
  });
});

describe('writeReport', () => {
  let outDir: string;

  beforeEach(() => {
    outDir = join(
      tmpdir(),
      `tracelane-wdio-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
  });

  afterEach(() => {
    rmSync(outDir, { recursive: true, force: true });
  });

  const sampleEvents: eventWithTime[] = [
    { type: 4, data: { href: 'https://app.test', width: 1280, height: 720 }, timestamp: 1 },
    { type: 2, data: { node: {}, initialOffset: { left: 0, top: 0 } }, timestamp: 2 },
  ] as unknown as eventWithTime[];

  it('creates the outDir and writes an .html report under it', () => {
    const path = writeReport({
      outDir,
      cid: '0-0',
      events: sampleEvents,
      meta: { title: 'failing test', status: 'failed', spec: 'test/x.spec.ts', error: 'boom' },
    });
    expect(existsSync(path)).toBe(true);
    expect(path.endsWith('.html')).toBe(true);
    const html = readFileSync(path, 'utf8');
    expect(html.slice(0, 200).toLowerCase()).toContain('<!doctype html>');
  });

  it('produces a report comfortably under the 25 MB budget for a small session', () => {
    const path = writeReport({
      outDir,
      events: sampleEvents,
      meta: { title: 't', status: 'failed' },
    });
    const bytes = statSync(path).size;
    expect(bytes).toBeLessThan(25 * 1024 * 1024);
  });
});
