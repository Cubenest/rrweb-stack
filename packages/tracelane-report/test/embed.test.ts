import { EventType, compress, decompress } from '@cubenest/rrweb-core';
import type { eventWithTime } from '@cubenest/rrweb-core';
import { describe, expect, it } from 'vitest';
import { decodeEventsBlob, encodeEventsBlob } from '../src/embed';

function sampleEvents(): eventWithTime[] {
  return [
    { type: EventType.Meta, data: { href: 'http://x/', width: 1280, height: 720 }, timestamp: 1 },
    { type: EventType.FullSnapshot, data: { node: { id: 1 }, initialOffset: {} }, timestamp: 2 },
    { type: EventType.IncrementalSnapshot, data: { source: 1, positions: [] }, timestamp: 3 },
  ] as unknown as eventWithTime[];
}

// Task 2.9 — events → JSON → gzip → base64 embedding, with an in-page-style
// decode round-trip. The build side compresses with @cubenest/rrweb-core's
// fflate gzip; the encoded blob is what gets dropped into the report's
// EVENTS_GZ_B64 string.
describe('events blob encoding (Task 2.9)', () => {
  it('encodes to a base64 ASCII string safe for an HTML string literal', () => {
    const b64 = encodeEventsBlob(sampleEvents());
    expect(typeof b64).toBe('string');
    expect(b64.length).toBeGreaterThan(0);
    // Strict base64 alphabet only — no chars that would break a JS string literal.
    expect(b64).toMatch(/^[A-Za-z0-9+/]+={0,2}$/);
  });

  it('round-trips: encode → decode === original events', () => {
    const events = sampleEvents();
    const decoded = decodeEventsBlob(encodeEventsBlob(events));
    expect(decoded).toEqual(events);
  });

  it('the encoded blob is exactly base64(compress(events))', () => {
    const events = sampleEvents();
    const b64 = encodeEventsBlob(events);
    // Decoding the base64 back to bytes and decompressing with the substrate's
    // own decompress() must recover the events — i.e. the wire format is
    // interoperable with @cubenest/rrweb-core's compress/decompress pair.
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    expect(decompress(bytes)).toEqual(events);
    // And compressing independently yields the same base64 (deterministic).
    expect(b64).toBe(btoa(String.fromCharCode(...compress(events))));
  });

  it('handles an empty event array', () => {
    expect(decodeEventsBlob(encodeEventsBlob([]))).toEqual([]);
  });
});
