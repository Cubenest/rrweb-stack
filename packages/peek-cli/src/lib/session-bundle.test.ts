import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  BUNDLE_FORMAT_VERSION,
  FULLSNAPSHOT_CAVEAT,
  packBundle,
  unpackBundle,
  verifyBundle,
} from '@peekdev/mcp/session-bundle';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'peek-bundle-'));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

const payload = () => ({
  session: {
    id: 's_orig',
    created_at: '2026-06-27T00:00:00.000Z',
    url: 'https://app.test',
    status: 'finalized',
  },
  consoleEvents: [{ session_id: 's_orig', ts_ms: 1000, level: 'error', message: 'boom' }],
  networkEvents: [
    { session_id: 's_orig', ts_ms: 1001, method: 'GET', url: 'https://app.test/x', status: 500 },
  ],
  events: [{ type: 4, data: { href: 'https://app.test' }, timestamp: 1000 }],
});

describe('session bundle codec', () => {
  it('round-trips pack -> unpack with all members intact', () => {
    const out = join(dir, 's_orig.peekbundle');
    packBundle(out, payload());
    const got = unpackBundle(out);
    expect(got.manifest.formatVersion).toBe(BUNDLE_FORMAT_VERSION);
    expect(got.manifest.originalSessionId).toBe('s_orig');
    expect(got.manifest.caveat).toBe(FULLSNAPSHOT_CAVEAT);
    expect(got.session.session.id).toBe('s_orig');
    expect(got.events).toHaveLength(1);
    expect((got.events[0] as { timestamp: number }).timestamp).toBe(1000);
    expect(got.session.consoleEvents).toHaveLength(1);
    expect(got.session.networkEvents).toHaveLength(1);
  });

  it('verifyBundle passes for an untampered bundle', () => {
    const out = join(dir, 'b.peekbundle');
    packBundle(out, payload());
    expect(() => verifyBundle(unpackBundle(out))).not.toThrow();
  });

  it('verifyBundle throws when a member is tampered', () => {
    const out = join(dir, 'b.peekbundle');
    packBundle(out, payload());
    const got = unpackBundle(out);
    got.events.push({ type: 3, data: {}, timestamp: 2000 });
    expect(() => verifyBundle(got)).toThrow(/integrity|sha256|checksum/i);
  });

  it('verifyBundle throws on an unsupported formatVersion', () => {
    const out = join(dir, 'b.peekbundle');
    packBundle(out, payload());
    const got = unpackBundle(out);
    got.manifest.formatVersion = 99;
    expect(() => verifyBundle(got)).toThrow(/formatVersion/i);
  });
});
