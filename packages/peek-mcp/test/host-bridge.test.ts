import { PassThrough } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { LocalSocketHostBridge } from '../src/mcp/host-bridge.js';
import { hostSocketPath } from '../src/native-host/socket-path.js';

describe('hostSocketPath', () => {
  it.skipIf(process.platform === 'win32')(
    'derives a posix socket directly inside the peek data dir',
    () => {
      // The arg is the peek data dir (PEEK_HOME / ~/.peek), not the user home.
      expect(hostSocketPath('/h/.peek')).toBe('/h/.peek/host.sock');
    },
  );
});

/**
 * A SocketLike backed by two PassThrough streams: bytes the bridge writes flow
 * to `toServer`; bytes the "server" writes flow to `toClient` which the bridge
 * reads. No real socket — the framing + correlation logic is what's under test.
 */
function fakeDuplex(toServer: PassThrough, toClient: PassThrough) {
  return {
    write: (b: string) => {
      toServer.write(b);
    },
    on: (e: string, h: (...a: unknown[]) => void) => {
      toClient.on(e, h);
    },
    end() {},
  };
}

describe('LocalSocketHostBridge', () => {
  it('frames an act.request and resolves on the matching act.response', async () => {
    const toServer = new PassThrough();
    const toClient = new PassThrough();
    const bridge = new LocalSocketHostBridge({
      connect: () => fakeDuplex(toServer, toClient) as never,
    });

    // Server side: read one frame, reply with the matching id.
    toServer.once('data', (buf: Buffer) => {
      const msg = JSON.parse(String(buf).trim());
      expect(msg.kind).toBe('act.request');
      expect(msg.payload.tool).toBe('execute_action');
      toClient.write(
        `${JSON.stringify({
          kind: 'act.response',
          id: msg.id,
          payload: { verdict: 'allow', result: 'ok', approver: 'user' },
        })}\n`,
      );
    });

    const res = await bridge.request({
      tool: 'execute_action',
      sessionId: 's',
      action: { type: 'click', selector: '#x', button: 'left' } as never,
      client: 'test',
    });
    expect(res.verdict).toBe('allow');
    expect(res.result).toBe('ok');
  });

  it('correlates concurrent requests to their own responses', async () => {
    const toServer = new PassThrough();
    const toClient = new PassThrough();
    const bridge = new LocalSocketHostBridge({
      connect: () => fakeDuplex(toServer, toClient) as never,
    });

    const received: Array<{ id: string; selector: string }> = [];
    toServer.on('data', (buf: Buffer) => {
      // A chunk may carry multiple newline-framed messages.
      for (const line of String(buf).split('\n')) {
        if (!line.trim()) continue;
        const msg = JSON.parse(line);
        received.push({ id: msg.id, selector: msg.payload.action.selector });
      }
    });

    const p1 = bridge.request({
      tool: 'execute_action',
      sessionId: 's',
      action: { type: 'click', selector: '#one', button: 'left' } as never,
      client: 'test',
    });
    const p2 = bridge.request({
      tool: 'execute_action',
      sessionId: 's',
      action: { type: 'click', selector: '#two', button: 'left' } as never,
      client: 'test',
    });

    // Wait until both requests have hit the wire.
    for (let i = 0; i < 50 && received.length < 2; i++) {
      await new Promise((r) => setTimeout(r, 2));
    }
    expect(received).toHaveLength(2);
    const one = received.find((r) => r.selector === '#one');
    const two = received.find((r) => r.selector === '#two');
    expect(one).toBeDefined();
    expect(two).toBeDefined();

    // Reply to #two FIRST (out of order) to prove correlation isn't FIFO.
    toClient.write(
      `${JSON.stringify({
        kind: 'act.response',
        id: two?.id,
        payload: { verdict: 'allow', result: 'ok', approver: 'user', details: 'two' },
      })}\n`,
    );
    toClient.write(
      `${JSON.stringify({
        kind: 'act.response',
        id: one?.id,
        payload: { verdict: 'deny', result: 'denied', approver: 'user', details: 'one' },
      })}\n`,
    );

    const [r1, r2] = await Promise.all([p1, p2]);
    expect(r1.details).toBe('one');
    expect(r1.result).toBe('denied');
    expect(r2.details).toBe('two');
    expect(r2.result).toBe('ok');
  });

  it('rejects→structured error when the socket is unavailable', async () => {
    const bridge = new LocalSocketHostBridge({
      connect: () => {
        throw new Error('ECONNREFUSED');
      },
    });
    const res = await bridge.request({
      tool: 'execute_action',
      sessionId: 's',
      action: { type: 'click', selector: '#x', button: 'left' } as never,
      client: 'test',
    });
    expect(res.verdict).toBe('deny');
    expect(res.result).toBe('error');
    expect(res.error).toContain('ECONNREFUSED');
  });

  // Item F: match the server side's setEncoding('utf8') so a multibyte UTF-8
  // char split across two socket reads can't corrupt a frame; cap the line
  // buffer so a malformed peer can't make the bridge buffer unbounded.
  it('calls setEncoding("utf8") on the socket when available', async () => {
    const toServer = new PassThrough();
    const toClient = new PassThrough();
    let encoding: string | undefined;
    const bridge = new LocalSocketHostBridge({
      connect: () =>
        ({
          ...fakeDuplex(toServer, toClient),
          setEncoding: (enc: string) => {
            encoding = enc;
          },
        }) as never,
    });
    // Trigger #ensure() by issuing a request (server never replies; we only
    // care that the socket was set up). Don't await — just let it wire up.
    void bridge.request({
      tool: 'execute_action',
      sessionId: 's',
      action: { type: 'click', selector: '#x', button: 'left' } as never,
      client: 'test',
      timeoutMs: 20,
    });
    await new Promise((r) => setTimeout(r, 5));
    expect(encoding).toBe('utf8');
  });

  it('drops the connection (clears the buffer) when a single line exceeds the cap', async () => {
    // A fresh duplex per connect() — mirrors production, where #reset() is
    // followed by a brand-new net.connect to a fresh socket.
    const conns: Array<{ toServer: PassThrough; toClient: PassThrough }> = [];
    const bridge = new LocalSocketHostBridge({
      connect: () => {
        const toServer = new PassThrough();
        const toClient = new PassThrough();
        conns.push({ toServer, toClient });
        return fakeDuplex(toServer, toClient) as never;
      },
      // Small enough that the 2000-byte unframed blob blows the cap, but larger
      // than a real ~110-byte framed act.response so a legit reply still parses.
      maxLineBytes: 300,
    });

    // First request: server replies with a HUGE unframed blob (no newline) that
    // blows past the cap → the bridge must reset rather than buffer unbounded.
    let firstId: string | undefined;
    const p1 = bridge.request({
      tool: 'execute_action',
      sessionId: 's',
      action: { type: 'click', selector: '#x', button: 'left' } as never,
      client: 'test',
      timeoutMs: 80,
    });
    // The first connection is now open; wire its server side.
    expect(conns).toHaveLength(1);
    conns[0]?.toServer.once('data', (buf: Buffer) => {
      firstId = JSON.parse(String(buf).trim()).id;
      conns[0]?.toClient.write('x'.repeat(2000)); // 2000 bytes, no newline → over the 300 cap
    });
    const r1 = await p1;
    expect(r1.result).toBe('error'); // over-cap blob discarded → fail-closed
    expect(firstId).toBeTypeOf('string');

    // The bridge reset its cached socket; a subsequent request reconnects on a
    // FRESH connection whose well-framed response parses correctly (proving the
    // 500 stale bytes weren't left in the buffer).
    const p2 = bridge.request({
      tool: 'execute_action',
      sessionId: 's',
      action: { type: 'click', selector: '#y', button: 'left' } as never,
      client: 'test',
      timeoutMs: 200,
    });
    expect(conns).toHaveLength(2);
    conns[1]?.toServer.once('data', (buf: Buffer) => {
      const id = JSON.parse(String(buf).trim()).id;
      conns[1]?.toClient.write(
        `${JSON.stringify({
          kind: 'act.response',
          id,
          payload: { verdict: 'allow', result: 'ok', approver: 'user' },
        })}\n`,
      );
    });
    const r2 = await p2;
    expect(r2.result).toBe('ok');
  });
});
