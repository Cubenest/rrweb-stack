import { fakeBrowser } from '@webext-core/fake-browser';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  PAIRED_CONNECTORS_KEY,
  type PairedConnector,
  type StorageAreaLike,
  clearPairedConnector,
  getPairedConnectors,
  putPairedConnector,
  sha256Hex,
  verifyConnectorSecret,
} from './pairing-store';

const area = fakeBrowser.storage.local as unknown as StorageAreaLike;

beforeEach(() => {
  fakeBrowser.reset();
});

afterEach(() => {
  fakeBrowser.reset();
});

// ---------------------------------------------------------------------------
// sha256Hex
// ---------------------------------------------------------------------------
describe('sha256Hex', () => {
  it('returns a 64-character lowercase hex string', async () => {
    const hex = await sha256Hex('test-secret');
    expect(hex).toHaveLength(64);
    expect(hex).toMatch(/^[0-9a-f]+$/);
  });

  it('is deterministic — same input yields same output', async () => {
    const a = await sha256Hex('connector-abc');
    const b = await sha256Hex('connector-abc');
    expect(a).toBe(b);
  });

  it('differs for different inputs', async () => {
    const a = await sha256Hex('secret-one');
    const b = await sha256Hex('secret-two');
    expect(a).not.toBe(b);
  });
});

// ---------------------------------------------------------------------------
// put→get round-trip
// ---------------------------------------------------------------------------
describe('putPairedConnector / getPairedConnectors', () => {
  it('returns {} when nothing is stored', async () => {
    expect(await getPairedConnectors(area)).toEqual({});
  });

  it('round-trips a single entry', async () => {
    const secret = 'my-super-secret';
    const hash = await sha256Hex(secret);
    const entry: PairedConnector = { clientName: 'Test Client', hash, pairedAtMs: 1_000_000 };

    await putPairedConnector('conn-1', entry, area);
    const result = await getPairedConnectors(area);

    expect(result['conn-1']).toEqual(entry);
  });

  it('keeps multiple connectors independent', async () => {
    const h1 = await sha256Hex('secret-one');
    const h2 = await sha256Hex('secret-two');
    const e1: PairedConnector = { clientName: 'A', hash: h1, pairedAtMs: 1000 };
    const e2: PairedConnector = { clientName: 'B', hash: h2, pairedAtMs: 2000 };

    await putPairedConnector('conn-a', e1, area);
    await putPairedConnector('conn-b', e2, area);

    const result = await getPairedConnectors(area);
    expect(result['conn-a']).toEqual(e1);
    expect(result['conn-b']).toEqual(e2);
  });

  it('overwrites the existing entry for the same id', async () => {
    const h1 = await sha256Hex('old-secret');
    const h2 = await sha256Hex('new-secret');
    await putPairedConnector('conn-x', { clientName: 'Old', hash: h1, pairedAtMs: 1000 }, area);
    await putPairedConnector('conn-x', { clientName: 'New', hash: h2, pairedAtMs: 2000 }, area);

    const result = await getPairedConnectors(area);
    expect(result['conn-x']).toEqual({ clientName: 'New', hash: h2, pairedAtMs: 2000 });
    expect(Object.keys(result)).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// verifyConnectorSecret
// ---------------------------------------------------------------------------
describe('verifyConnectorSecret', () => {
  it('returns true when the stored hash matches the given secret', async () => {
    const secret = 'correct-horse-battery-staple';
    const hash = await sha256Hex(secret);
    await putPairedConnector('conn-ok', { clientName: 'C', hash, pairedAtMs: 9000 }, area);

    expect(await verifyConnectorSecret('conn-ok', secret, area)).toBe(true);
  });

  it('returns false for a wrong secret', async () => {
    const hash = await sha256Hex('real-secret');
    await putPairedConnector('conn-ok', { clientName: 'C', hash, pairedAtMs: 9000 }, area);

    expect(await verifyConnectorSecret('conn-ok', 'wrong-secret', area)).toBe(false);
  });

  it('returns false for an unknown id', async () => {
    expect(await verifyConnectorSecret('never-paired', 'anything', area)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// clearPairedConnector
// ---------------------------------------------------------------------------
describe('clearPairedConnector', () => {
  it('removes the entry for the given id', async () => {
    const hash = await sha256Hex('s');
    await putPairedConnector('conn-del', { clientName: 'D', hash, pairedAtMs: 1 }, area);

    await clearPairedConnector('conn-del', area);

    const result = await getPairedConnectors(area);
    expect('conn-del' in result).toBe(false);
  });

  it('is a no-op for an unknown id — other entries are preserved', async () => {
    const hash = await sha256Hex('s');
    await putPairedConnector('conn-kept', { clientName: 'K', hash, pairedAtMs: 1 }, area);

    await clearPairedConnector('conn-gone', area);

    const result = await getPairedConnectors(area);
    expect(result['conn-kept']).toBeDefined();
    expect(Object.keys(result)).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// sanitize — drops malformed entries on read
// ---------------------------------------------------------------------------
describe('sanitize (malformed entries)', () => {
  it('drops entries missing clientName', async () => {
    await area.set({
      [PAIRED_CONNECTORS_KEY]: {
        bad: { hash: 'a'.repeat(64), pairedAtMs: 1 }, // no clientName
        good: { clientName: 'G', hash: 'b'.repeat(64), pairedAtMs: 2 },
      },
    });
    const result = await getPairedConnectors(area);
    expect(Object.keys(result)).toEqual(['good']);
  });

  it('drops entries with a non-string clientName', async () => {
    await area.set({
      [PAIRED_CONNECTORS_KEY]: {
        bad: { clientName: 42, hash: 'a'.repeat(64), pairedAtMs: 1 },
        good: { clientName: 'G', hash: 'b'.repeat(64), pairedAtMs: 2 },
      },
    });
    const result = await getPairedConnectors(area);
    expect(Object.keys(result)).toEqual(['good']);
  });

  it('drops entries with a non-hex-string hash', async () => {
    await area.set({
      [PAIRED_CONNECTORS_KEY]: {
        bad: { clientName: 'B', hash: 'not-hex!!!', pairedAtMs: 1 },
        good: { clientName: 'G', hash: 'c'.repeat(64), pairedAtMs: 2 },
      },
    });
    const result = await getPairedConnectors(area);
    expect(Object.keys(result)).toEqual(['good']);
  });

  it('drops entries with a non-numeric pairedAtMs', async () => {
    await area.set({
      [PAIRED_CONNECTORS_KEY]: {
        bad: { clientName: 'B', hash: 'a'.repeat(64), pairedAtMs: 'now' },
        good: { clientName: 'G', hash: 'b'.repeat(64), pairedAtMs: 2 },
      },
    });
    const result = await getPairedConnectors(area);
    expect(Object.keys(result)).toEqual(['good']);
  });

  it('returns {} when the stored value is not an object', async () => {
    await area.set({ [PAIRED_CONNECTORS_KEY]: 'oops' });
    expect(await getPairedConnectors(area)).toEqual({});
  });
});

// ---------------------------------------------------------------------------
// concurrent writers (write-lock mutex)
// ---------------------------------------------------------------------------
describe('concurrent writers (write-lock)', () => {
  function slowArea(): StorageAreaLike {
    let store: Record<string, unknown> = {};
    const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 1));
    return {
      async get(keys) {
        await tick();
        if (typeof keys === 'string') return { [keys]: store[keys] };
        return { ...store };
      },
      async set(items) {
        await tick();
        store = { ...store, ...items };
      },
    };
  }

  it('does not lose updates when two puts race on different ids', async () => {
    const slow = slowArea();
    const h1 = await sha256Hex('s1');
    const h2 = await sha256Hex('s2');

    await Promise.all([
      putPairedConnector('conn-1', { clientName: 'A', hash: h1, pairedAtMs: 1 }, slow),
      putPairedConnector('conn-2', { clientName: 'B', hash: h2, pairedAtMs: 2 }, slow),
    ]);

    const result = await getPairedConnectors(slow);
    expect(Object.keys(result).sort()).toEqual(['conn-1', 'conn-2']);
  });

  it('serializes a put + clear on the same id deterministically', async () => {
    const slow = slowArea();
    const hash = await sha256Hex('init');
    await putPairedConnector('conn-r', { clientName: 'R', hash, pairedAtMs: 1 }, slow);

    // clear submitted SECOND → runs last under FIFO → connector is absent.
    await Promise.all([
      putPairedConnector(
        'conn-r',
        { clientName: 'R2', hash: await sha256Hex('new'), pairedAtMs: 2 },
        slow,
      ),
      clearPairedConnector('conn-r', slow),
    ]);

    const result = await getPairedConnectors(slow);
    expect('conn-r' in result).toBe(false);
  });
});
