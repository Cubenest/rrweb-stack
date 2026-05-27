import { PassThrough } from 'node:stream';
import { describe, expect, it } from 'vitest';
import {
  LENGTH_PREFIX_BYTES,
  MAX_EXT_TO_HOST_BYTES,
  MAX_HOST_TO_EXT_BYTES,
  MessageDecoder,
  encodeMessage,
  readMessages,
  writeMessage,
} from '../src/native-host/transport.js';

describe('encodeMessage — 4-byte little-endian framing', () => {
  it('prefixes the UTF-8 JSON body with its little-endian length', () => {
    const value = { type: 'ping' };
    const body = Buffer.from(JSON.stringify(value), 'utf8');
    const framed = encodeMessage(value);

    expect(framed.length).toBe(LENGTH_PREFIX_BYTES + body.length);
    expect(framed.readUInt32LE(0)).toBe(body.length);
    expect(framed.subarray(LENGTH_PREFIX_BYTES).toString('utf8')).toBe(body.toString('utf8'));
  });

  it('writes the length little-endian, not big-endian', () => {
    // 256-byte body -> LE bytes are [0x00, 0x01, 0x00, 0x00].
    const padding = 'x'.repeat(256 - JSON.stringify({ v: '' }).length);
    const framed = encodeMessage({ v: padding });
    const header = framed.subarray(0, LENGTH_PREFIX_BYTES);
    expect(header[0]).toBe(0x00);
    expect(header[1]).toBe(0x01);
    expect(framed.readUInt32LE(0)).toBe(256);
    expect(framed.readUInt32BE(0)).not.toBe(256);
  });

  it('throws when the body exceeds the 1 MB host->ext cap', () => {
    const tooBig = { v: 'a'.repeat(MAX_HOST_TO_EXT_BYTES) };
    expect(() => encodeMessage(tooBig)).toThrow(/exceeds the .*host->ext cap/);
  });

  it('allows a body right at the cap boundary', () => {
    // Construct a payload whose encoded size is exactly the cap.
    const overhead = JSON.stringify({ v: '' }).length;
    const value = { v: 'a'.repeat(MAX_HOST_TO_EXT_BYTES - overhead) };
    const framed = encodeMessage(value);
    expect(framed.length).toBe(LENGTH_PREFIX_BYTES + MAX_HOST_TO_EXT_BYTES);
  });
});

describe('MessageDecoder', () => {
  it('decodes a single framed message', () => {
    const received: unknown[] = [];
    const decoder = new MessageDecoder((m) => received.push(m));
    decoder.push(encodeMessage({ hello: 'world' }));
    expect(received).toEqual([{ hello: 'world' }]);
    expect(decoder.pending).toBe(0);
  });

  it('decodes multiple messages delivered in a single chunk', () => {
    const received: unknown[] = [];
    const decoder = new MessageDecoder((m) => received.push(m));
    const combined = Buffer.concat([
      encodeMessage({ n: 1 }),
      encodeMessage({ n: 2 }),
      encodeMessage({ n: 3 }),
    ]);
    decoder.push(combined);
    expect(received).toEqual([{ n: 1 }, { n: 2 }, { n: 3 }]);
  });

  it('reassembles a message split across chunk boundaries', () => {
    const received: unknown[] = [];
    const decoder = new MessageDecoder((m) => received.push(m));
    const framed = encodeMessage({ msg: 'split me across chunks' });

    // Split mid-header, then mid-body, to exercise both buffering paths.
    decoder.push(framed.subarray(0, 2));
    expect(received).toHaveLength(0);
    decoder.push(framed.subarray(2, 6));
    expect(received).toHaveLength(0);
    decoder.push(framed.subarray(6));
    expect(received).toEqual([{ msg: 'split me across chunks' }]);
  });

  it('throws when a declared length exceeds the ext->host cap', () => {
    const received: unknown[] = [];
    // Tiny cap so we can trigger the guard without allocating 4 GB.
    const decoder = new MessageDecoder((m) => received.push(m), { maxBytes: 8 });
    const header = Buffer.allocUnsafe(LENGTH_PREFIX_BYTES);
    header.writeUInt32LE(9, 0); // 9 > cap of 8
    expect(() => decoder.push(header)).toThrow(/exceeds the .*ext->host cap/);
  });

  it('skips a malformed-JSON frame and still decodes the next valid frame', () => {
    const received: unknown[] = [];
    const errors: Error[] = [];
    const decoder = new MessageDecoder((m) => received.push(m), {
      onError: (e) => errors.push(e),
    });

    // Hand-build a frame with a valid length header but a non-JSON body.
    const badBody = Buffer.from('{not valid json', 'utf8');
    const badHeader = Buffer.allocUnsafe(LENGTH_PREFIX_BYTES);
    badHeader.writeUInt32LE(badBody.length, 0);
    const badFrame = Buffer.concat([badHeader, badBody]);

    // Deliver the bad frame followed by a good one in the same stream.
    const stream = Buffer.concat([badFrame, encodeMessage({ recovered: true })]);
    expect(() => decoder.push(stream)).not.toThrow();

    expect(errors).toHaveLength(1);
    expect(received).toEqual([{ recovered: true }]); // next valid frame still processed
    expect(decoder.pending).toBe(0); // stream stayed correctly aligned
  });

  it('exposes the 4 GB ext->host cap default', () => {
    expect(MAX_EXT_TO_HOST_BYTES).toBe(4 * 1024 * 1024 * 1024);
  });
});

describe('writeMessage / readMessages round-trip over a stream', () => {
  it('round-trips values through a PassThrough stream', async () => {
    const stream = new PassThrough();
    const received: unknown[] = [];
    const done = readMessages((m) => received.push(m), { input: stream });

    await writeMessage({ a: 1 }, stream);
    await writeMessage({ b: [2, 3], nested: { c: true } }, stream);
    stream.end();

    await done;
    expect(received).toEqual([{ a: 1 }, { b: [2, 3], nested: { c: true } }]);
  });

  it('skips a malformed frame mid-stream without rejecting the promise', async () => {
    const stream = new PassThrough();
    const received: unknown[] = [];
    const errors: Error[] = [];
    const done = readMessages((m) => received.push(m), {
      input: stream,
      onError: (e) => errors.push(e),
    });

    const badBody = Buffer.from('not json at all', 'utf8');
    const badHeader = Buffer.allocUnsafe(4);
    badHeader.writeUInt32LE(badBody.length, 0);
    stream.write(Buffer.concat([badHeader, badBody]));
    await writeMessage({ after: 'bad' }, stream);
    stream.end();

    await expect(done).resolves.toBeUndefined();
    expect(errors).toHaveLength(1);
    expect(received).toEqual([{ after: 'bad' }]);
  });

  it('writeMessage emits a correctly framed buffer to the stream', async () => {
    const stream = new PassThrough();
    const chunks: Buffer[] = [];
    stream.on('data', (c: Buffer) => chunks.push(c));

    await writeMessage({ ok: true }, stream);
    stream.end();
    await new Promise((r) => stream.on('end', r));

    const all = Buffer.concat(chunks);
    const bodyLen = all.readUInt32LE(0);
    expect(
      JSON.parse(all.subarray(LENGTH_PREFIX_BYTES, LENGTH_PREFIX_BYTES + bodyLen).toString('utf8')),
    ).toEqual({
      ok: true,
    });
  });
});
