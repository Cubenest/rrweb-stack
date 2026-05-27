import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { compress, type eventWithTime } from '@cubenest/rrweb-core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SessionEventsError, loadSessionEvents } from '../src/mcp/event-blobs.js';

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'peek-blobs-'));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('loadSessionEvents', () => {
  it('returns [] for a null/empty blob path (active session, never flushed)', () => {
    expect(loadSessionEvents(null, dir)).toEqual([]);
    expect(loadSessionEvents(undefined, dir)).toEqual([]);
    expect(loadSessionEvents('', dir)).toEqual([]);
  });

  it('returns [] when the blob file is missing (pruned by retention)', () => {
    expect(loadSessionEvents('gone.rrweb.gz', dir)).toEqual([]);
  });

  it('round-trips a valid gzipped event array', () => {
    const events = [
      { type: 4, data: { href: 'https://x', width: 1, height: 1 }, timestamp: 1 },
    ] as unknown as eventWithTime[];
    writeFileSync(join(dir, 'ok.rrweb.gz'), compress(events));
    expect(loadSessionEvents('ok.rrweb.gz', dir)).toHaveLength(1);
  });

  it('throws SessionEventsError (not a raw crash) on a corrupt/truncated gzip', () => {
    // Random bytes that are not a valid gzip frame.
    writeFileSync(join(dir, 'corrupt.rrweb.gz'), Buffer.from([0x1f, 0x8b, 0x00, 0x01, 0x02, 0x03]));
    expect(() => loadSessionEvents('corrupt.rrweb.gz', dir)).toThrow(SessionEventsError);
    try {
      loadSessionEvents('corrupt.rrweb.gz', dir);
    } catch (err) {
      expect(err).toBeInstanceOf(SessionEventsError);
      expect((err as SessionEventsError).message).toContain('corrupt.rrweb.gz');
    }
  });

  it('throws SessionEventsError when the gzip decompresses to non-array JSON', () => {
    // Valid (standard) gzip, but the payload is an object, not an eventWithTime[].
    // fflate's gunzip reads Node zlib's RFC-1952 output fine; decompress then
    // rejects the non-array payload, which loadSessionEvents wraps.
    const gz = gzipSync(Buffer.from(JSON.stringify({ not: 'an array' })));
    writeFileSync(join(dir, 'object.rrweb.gz'), gz);
    expect(() => loadSessionEvents('object.rrweb.gz', dir)).toThrow(SessionEventsError);
  });
});
