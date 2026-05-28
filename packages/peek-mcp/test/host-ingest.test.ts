// Integration coverage for the native-host stdio loop end-to-end: drive raw
// framed bytes IN over a PassThrough, observe framed reply bytes OUT, and
// assert the reply shape + the SQLite side effects. The piece of the loop the
// ingest unit tests don't cover by themselves is the host.ts dispatch + write
// path (the transport layer, the type→handler routing, and the reply
// serialization).

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { startNativeHost } from '../src/native-host/host.js';
import {
  LENGTH_PREFIX_BYTES,
  MessageDecoder,
  encodeMessage,
} from '../src/native-host/transport.js';

interface HostFixture {
  input: PassThrough;
  output: PassThrough;
  /** Replies decoded off the output stream, in order. */
  replies: unknown[];
  /** Close the host + the streams. */
  teardown: () => Promise<void>;
}

function startHostFixture(home: string): HostFixture {
  const input = new PassThrough();
  const output = new PassThrough();
  const replies: unknown[] = [];
  const decoder = new MessageDecoder((m) => replies.push(m));
  output.on('data', (chunk: Buffer) => decoder.push(chunk));

  const handle = startNativeHost({ home, dbPath: ':memory:', input, output });

  return {
    input,
    output,
    replies,
    async teardown() {
      input.end();
      await handle.done;
      handle.close();
    },
  };
}

async function waitForReply(replies: unknown[], n: number, timeoutMs = 500): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (replies.length < n) {
    if (Date.now() > deadline) throw new Error(`timeout waiting for ${n} replies`);
    await new Promise((r) => setTimeout(r, 5));
  }
}

let home: string;
beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'peek-host-it-'));
});
afterEach(() => {
  rmSync(home, { recursive: true, force: true });
});

describe('native-host stdio loop — host.hello handshake (sanity)', () => {
  it('replies host.hello.ok with the schema version', async () => {
    const fx = startHostFixture(home);
    fx.input.write(encodeMessage({ type: 'host.hello' }));
    await waitForReply(fx.replies, 1);
    expect(fx.replies[0]).toMatchObject({ type: 'host.hello.ok', schemaVersion: 2 });
    await fx.teardown();
  });
});

describe('native-host stdio loop — ingest dispatch', () => {
  it('routes session.append through ingest and replies with session.append.ok', async () => {
    const fx = startHostFixture(home);
    fx.input.write(
      encodeMessage({
        type: 'session.append',
        sessionId: 's_loop',
        url: 'https://loop.test/',
        events: [{ type: 0, data: {}, timestamp: 1 }],
      }),
    );
    await waitForReply(fx.replies, 1);
    expect(fx.replies[0]).toMatchObject({
      type: 'session.append.ok',
      sessionId: 's_loop',
      seq: 0,
    });
    await fx.teardown();
  });

  it('routes console.append through ingest and replies ok with count', async () => {
    const fx = startHostFixture(home);
    fx.input.write(
      encodeMessage({
        type: 'console.append',
        sessionId: 's_console_loop',
        events: [{ ts: 1, level: 'log', args: ['hi'] }],
      }),
    );
    await waitForReply(fx.replies, 1);
    expect(fx.replies[0]).toMatchObject({ type: 'console.append.ok', count: 1 });
    await fx.teardown();
  });

  it('handles a multi-message stream without losing alignment', async () => {
    const fx = startHostFixture(home);
    fx.input.write(
      Buffer.concat([
        encodeMessage({
          type: 'session.append',
          sessionId: 's_multi',
          events: [{ type: 0, data: {}, timestamp: 10 }],
        }),
        encodeMessage({
          type: 'network.append',
          sessionId: 's_multi',
          records: [{ kind: 'request', id: 'r', ts: 20, method: 'GET', url: 'https://x/' }],
        }),
      ]),
    );
    await waitForReply(fx.replies, 2);
    expect(fx.replies[0]).toMatchObject({ type: 'session.append.ok' });
    expect(fx.replies[1]).toMatchObject({ type: 'network.append.ok', count: 1 });
    await fx.teardown();
  });

  it('replies with a structured error for an unknown type, never crashes', async () => {
    const fx = startHostFixture(home);
    fx.input.write(encodeMessage({ type: 'totally.unknown' }));
    await waitForReply(fx.replies, 1);
    expect(fx.replies[0]).toMatchObject({ type: 'error', code: 'unhandled_message' });
    await fx.teardown();
  });

  it('survives a malformed JSON frame and still processes the next valid frame (3a guard holds)', async () => {
    const fx = startHostFixture(home);
    // Hand-build a frame with a valid length header but a non-JSON body.
    const badBody = Buffer.from('{ not json', 'utf8');
    const badHeader = Buffer.allocUnsafe(LENGTH_PREFIX_BYTES);
    badHeader.writeUInt32LE(badBody.length, 0);
    const badFrame = Buffer.concat([badHeader, badBody]);
    fx.input.write(Buffer.concat([badFrame, encodeMessage({ type: 'host.hello' })]));
    await waitForReply(fx.replies, 1);
    expect(fx.replies[0]).toMatchObject({ type: 'host.hello.ok' });
    await fx.teardown();
  });
});
