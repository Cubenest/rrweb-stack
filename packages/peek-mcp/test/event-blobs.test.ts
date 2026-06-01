import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
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

  // The native-host writer (see packages/peek-mcp/src/native-host/ingest.ts)
  // persists session events as one gzipped chunk per `session.append` batch at
  // `<dir>/<sessionId>/<seq>.json.gz`, and stores the directory as the session's
  // events_blob_path. The reader has to walk those chunks in seq order.
  describe('directory layout (one .json.gz per append batch)', () => {
    it('concatenates per-seq chunks in numeric order', () => {
      const sessionDir = join(dir, 'sess1');
      mkdirSync(sessionDir);
      const chunk0 = [
        { type: 0, data: {}, timestamp: 1 },
        { type: 4, data: { href: 'https://x', width: 1, height: 1 }, timestamp: 2 },
      ] as unknown as eventWithTime[];
      const chunk1 = [{ type: 3, data: { source: 0 }, timestamp: 3 }] as unknown as eventWithTime[];
      const chunk10 = [
        { type: 3, data: { source: 0 }, timestamp: 10 },
      ] as unknown as eventWithTime[];
      // Write out-of-order to confirm numeric (not lexicographic) sorting.
      writeFileSync(join(sessionDir, '10.json.gz'), compress(chunk10));
      writeFileSync(join(sessionDir, '0.json.gz'), compress(chunk0));
      writeFileSync(join(sessionDir, '1.json.gz'), compress(chunk1));

      const events = loadSessionEvents('sess1', dir);
      expect(events.map((e) => e.timestamp)).toEqual([1, 2, 3, 10]);
    });

    it('returns [] for an empty session directory (active, never flushed)', () => {
      const sessionDir = join(dir, 'empty-sess');
      mkdirSync(sessionDir);
      expect(loadSessionEvents('empty-sess', dir)).toEqual([]);
    });

    it('ignores stray non-chunk files in the session directory', () => {
      const sessionDir = join(dir, 'sess2');
      mkdirSync(sessionDir);
      const chunk0 = [
        { type: 4, data: { href: 'https://x', width: 1, height: 1 }, timestamp: 1 },
      ] as unknown as eventWithTime[];
      writeFileSync(join(sessionDir, '0.json.gz'), compress(chunk0));
      writeFileSync(join(sessionDir, 'README'), 'not a chunk');
      writeFileSync(join(sessionDir, 'tmp.json.gz.partial'), 'half-written');

      const events = loadSessionEvents('sess2', dir);
      expect(events).toHaveLength(1);
    });

    it('tolerates pre-alpha.10 rows that stored a `rrweb-events/` prefix', () => {
      // Pre-fix the writer prepended `rrweb-events/` to events_blob_path. The
      // reader's baseDir already points at the `rrweb-events/` subdir, so naive
      // join() produced a doubled path that didn't exist. Existing user data
      // still needs to load — strip the leading segment if present.
      const sessionDir = join(dir, 'legacy-sess');
      mkdirSync(sessionDir);
      const chunk0 = [
        { type: 4, data: { href: 'https://x', width: 1, height: 1 }, timestamp: 1 },
      ] as unknown as eventWithTime[];
      writeFileSync(join(sessionDir, '0.json.gz'), compress(chunk0));

      const events = loadSessionEvents('rrweb-events/legacy-sess', dir);
      expect(events).toHaveLength(1);
    });

    it('throws SessionEventsError naming the chunk if one chunk is corrupt', () => {
      const sessionDir = join(dir, 'sess3');
      mkdirSync(sessionDir);
      const chunk0 = [
        { type: 4, data: { href: 'https://x', width: 1, height: 1 }, timestamp: 1 },
      ] as unknown as eventWithTime[];
      writeFileSync(join(sessionDir, '0.json.gz'), compress(chunk0));
      // 1.json.gz is a non-gzip blob.
      writeFileSync(join(sessionDir, '1.json.gz'), Buffer.from([0x1f, 0x8b, 0x00, 0x01, 0x02]));

      expect(() => loadSessionEvents('sess3', dir)).toThrow(SessionEventsError);
      try {
        loadSessionEvents('sess3', dir);
      } catch (err) {
        expect((err as SessionEventsError).message).toContain('sess3/1.json.gz');
      }
    });
  });
});
