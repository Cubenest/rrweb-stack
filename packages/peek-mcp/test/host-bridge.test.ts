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
});
