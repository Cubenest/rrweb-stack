import { EventEmitter } from 'node:events';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import * as net from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { HostSocketServer, cleanupStaleSocket } from '../src/native-host/host-socket.js';
import { EMPTY_POLICY, type LoadedPolicy } from '../src/native-host/policy.js';

/**
 * A fake connection: collects bytes written to it (the "client" side reads
 * these) and lets the test push inbound frames (the "client" side wrote them).
 * Mirrors the real `net.Socket` duplex surface the server consumes.
 */
class FakeConnection extends EventEmitter {
  written: string[] = [];
  write(data: string): void {
    this.written.push(data);
  }
  /** Push an inbound chunk as if the client wrote it. */
  feed(line: string): void {
    this.emit('data', Buffer.from(line));
  }
  /** All written frames parsed from newline-delimited JSON. */
  frames(): Array<{ kind: string; id: string; payload: unknown }> {
    return this.written
      .join('')
      .split('\n')
      .filter((l) => l.trim().length > 0)
      .map((l) => JSON.parse(l));
  }
}

/**
 * A fake net server: the server-under-test registers an `onConnection`
 * callback; the test drives connections by calling `.connect()`.
 */
class FakeNetServer {
  #onConnection: ((conn: FakeConnection) => void) | undefined;
  listening = false;
  onConnection(cb: (conn: FakeConnection) => void): void {
    this.#onConnection = cb;
  }
  listen(): void {
    this.listening = true;
  }
  close(): void {
    this.listening = false;
  }
  connect(): FakeConnection {
    const conn = new FakeConnection();
    this.#onConnection?.(conn);
    return conn;
  }
}

function makeServer(overrides?: {
  postToSw?: (msg: unknown) => void;
  loadPolicy?: () => LoadedPolicy;
  ids?: string[];
}) {
  const posted: unknown[] = [];
  const net = new FakeNetServer();
  const idQueue = overrides?.ids ? [...overrides.ids] : ['rid-1', 'rid-2', 'rid-3'];
  let n = 0;
  const server = new HostSocketServer({
    postToSw: overrides?.postToSw ?? ((m) => posted.push(m)),
    loadPolicy: overrides?.loadPolicy ?? (() => EMPTY_POLICY),
    generateRequestId: () => idQueue[n++] ?? `rid-${n}`,
    createServer: (handler) => {
      net.onConnection(handler);
      return net as never;
    },
  });
  server.listen();
  return { server, net, posted };
}

describe('HostSocketServer', () => {
  it('relays an inbound act.request → postToSw(action.request) with a fresh requestId + policy', () => {
    const { net, posted } = makeServer({
      loadPolicy: () => ({
        destructiveTerms: { add: ['yeet'], remove: ['confirm'] },
        allowListBySite: {},
      }),
    });
    const conn = net.connect();
    conn.feed(
      `${JSON.stringify({
        kind: 'act.request',
        id: 'wire-1',
        payload: {
          tool: 'execute_action',
          sessionId: 's',
          action: { type: 'click', selector: '#x', button: 'left' },
          client: 'cursor',
        },
      })}\n`,
    );

    expect(posted).toHaveLength(1);
    const msg = posted[0] as Record<string, unknown>;
    expect(msg.type).toBe('action.request');
    expect(msg.requestId).toBe('rid-1');
    expect(msg.tool).toBe('execute_action');
    expect(msg.sessionId).toBe('s');
    expect(msg.client).toBe('cursor');
    expect(msg.policy).toEqual({ add: ['yeet'], remove: ['confirm'] });
    expect(msg.action).toMatchObject({ type: 'click', selector: '#x' });
  });

  it('threads a confirmToken from the act.request payload onto action.request', () => {
    const { net, posted } = makeServer();
    const conn = net.connect();
    conn.feed(
      `${JSON.stringify({
        kind: 'act.request',
        id: 'wire-1',
        payload: {
          tool: 'execute_action',
          sessionId: 's',
          action: { type: 'click', selector: '#x', button: 'left' },
          client: 'cursor',
          confirmToken: 'tok-abc',
        },
      })}\n`,
    );
    expect((posted[0] as Record<string, unknown>).confirmToken).toBe('tok-abc');
  });

  it('writes an act.response back to the originating connection on action.result', () => {
    const { server, net } = makeServer();
    const conn = net.connect();
    conn.feed(
      `${JSON.stringify({
        kind: 'act.request',
        id: 'wire-7',
        payload: {
          tool: 'execute_action',
          sessionId: 's',
          action: { type: 'click', selector: '#x', button: 'left' },
          client: 'cursor',
        },
      })}\n`,
    );

    server.onSwMessage({
      type: 'action.result',
      requestId: 'rid-1',
      tool: 'execute_action',
      verdict: 'allow',
      result: 'ok',
      approver: 'user',
      approvalMs: 123,
      details: { dispatched: true },
    });

    const frames = conn.frames();
    expect(frames).toHaveLength(1);
    expect(frames[0]?.kind).toBe('act.response');
    // The act.response echoes the ORIGINAL wire id ('wire-7'), not requestId.
    expect(frames[0]?.id).toBe('wire-7');
    const payload = frames[0]?.payload as Record<string, unknown>;
    expect(payload.verdict).toBe('allow');
    expect(payload.result).toBe('ok');
    expect(payload.approver).toBe('user');
    expect(payload.approvalMs).toBe(123);
    expect(payload.details).toEqual({ dispatched: true });
    // The wire-protocol fields type/requestId are dropped from the mapped payload.
    expect('type' in payload).toBe(false);
    expect('requestId' in payload).toBe(false);
  });

  it('carries confirmToken on a request_authorization action.result', () => {
    const { server, net } = makeServer();
    const conn = net.connect();
    conn.feed(
      `${JSON.stringify({
        kind: 'act.request',
        id: 'wire-9',
        payload: {
          tool: 'request_authorization',
          sessionId: 's',
          action: { type: 'click', selector: '#x', button: 'left' },
          client: 'cursor',
        },
      })}\n`,
    );
    server.onSwMessage({
      type: 'action.result',
      requestId: 'rid-1',
      tool: 'request_authorization',
      verdict: 'allow',
      result: 'ok',
      approver: 'user',
      confirmToken: 'tok-xyz',
    });
    const payload = conn.frames()[0]?.payload as Record<string, unknown>;
    expect(payload.confirmToken).toBe('tok-xyz');
  });

  it('isolates concurrent requests across two connections', () => {
    const { server, net } = makeServer({ ids: ['ridA', 'ridB'] });
    const connA = net.connect();
    const connB = net.connect();
    connA.feed(
      `${JSON.stringify({
        kind: 'act.request',
        id: 'a1',
        payload: {
          tool: 'execute_action',
          sessionId: 'sA',
          action: { type: 'click', selector: '#a', button: 'left' },
          client: 'cursor',
        },
      })}\n`,
    );
    connB.feed(
      `${JSON.stringify({
        kind: 'act.request',
        id: 'b1',
        payload: {
          tool: 'execute_action',
          sessionId: 'sB',
          action: { type: 'click', selector: '#b', button: 'left' },
          client: 'cursor',
        },
      })}\n`,
    );

    // Reply to B's request first.
    server.onSwMessage({
      type: 'action.result',
      requestId: 'ridB',
      tool: 'execute_action',
      verdict: 'allow',
      result: 'ok',
      approver: 'user',
    });
    expect(connB.frames()).toHaveLength(1);
    expect(connB.frames()[0]?.id).toBe('b1');
    expect(connA.written).toHaveLength(0); // A untouched

    server.onSwMessage({
      type: 'action.result',
      requestId: 'ridA',
      tool: 'execute_action',
      verdict: 'deny',
      result: 'denied',
      approver: 'user',
    });
    expect(connA.frames()).toHaveLength(1);
    expect(connA.frames()[0]?.id).toBe('a1');
  });

  it('drops an action.result for an unknown requestId without throwing', () => {
    const { server } = makeServer();
    expect(() =>
      server.onSwMessage({
        type: 'action.result',
        requestId: 'never-seen',
        tool: 'execute_action',
        verdict: 'allow',
        result: 'ok',
        approver: 'user',
      }),
    ).not.toThrow();
  });

  it('ignores action.confirm.shown as a non-terminal timing signal (no act.response)', () => {
    const { server, net } = makeServer();
    const conn = net.connect();
    conn.feed(
      `${JSON.stringify({
        kind: 'act.request',
        id: 'wire-c',
        payload: {
          tool: 'execute_action',
          sessionId: 's',
          action: { type: 'click', selector: '#x', button: 'left' },
          client: 'cursor',
        },
      })}\n`,
    );
    server.onSwMessage({ type: 'action.confirm.shown', requestId: 'rid-1', shownAtMs: 5 });
    // No terminal response yet — the verdict still arrives in a later result.
    expect(conn.written).toHaveLength(0);
    server.onSwMessage({
      type: 'action.result',
      requestId: 'rid-1',
      tool: 'execute_action',
      verdict: 'allow',
      result: 'ok',
      approver: 'user',
    });
    expect(conn.frames()).toHaveLength(1);
  });
});

// Item E: a crashed/SIGKILLed host leaves the socket file behind; the next
// launch must clean it up before listen() or it throws EADDRINUSE and the
// write-path is silently dead until manual `rm`.
describe.skipIf(process.platform === 'win32')('stale-socket cleanup (item E)', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'peek-staletest-'));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  /** Bind a throwaway server to leave a real socket inode at `path`. */
  function bindStaleSocket(path: string): Promise<net.Server> {
    return new Promise((resolve, reject) => {
      const prior = net.createServer();
      prior.on('error', reject);
      prior.listen(path, () => resolve(prior));
    });
  }

  it('cleanupStaleSocket unlinks an existing socket file but NOT a regular file', async () => {
    const sockPath = join(dir, 'host.sock');
    // A live bound server guarantees a socket-type inode at the path (this is
    // exactly the stale artifact a crashed host leaves: a socket file with no
    // live owner from the NEW process's perspective).
    const prior = await bindStaleSocket(sockPath);
    try {
      expect(existsSync(sockPath)).toBe(true);
      cleanupStaleSocket(sockPath);
      expect(existsSync(sockPath)).toBe(false);
    } finally {
      prior.close();
    }

    // A REGULAR file at the path must be preserved (guard against clobbering a
    // real file the user / another process owns).
    const regular = join(dir, 'not-a-socket.txt');
    writeFileSync(regular, 'keep me');
    cleanupStaleSocket(regular);
    expect(existsSync(regular)).toBe(true);
  });

  it('cleanupStaleSocket is a no-op when nothing exists at the path', () => {
    expect(() => cleanupStaleSocket(join(dir, 'nothing-here.sock'))).not.toThrow();
  });

  it('HostSocketServer.listen() succeeds + accepts a connection when a stale socket exists', async () => {
    const sockPath = join(dir, 'host.sock');
    // Leave a real socket inode (a crashed prior host). We keep `prior` bound so
    // the file is guaranteed present; cleanupStaleSocket unlinks it before bind.
    const prior = await bindStaleSocket(sockPath);
    expect(existsSync(sockPath)).toBe(true);

    let posted: unknown;
    const server = new HostSocketServer({
      postToSw: (m) => {
        posted = m;
      },
      loadPolicy: () => EMPTY_POLICY,
      generateRequestId: () => 'rid-stale',
      socketPath: sockPath,
    });
    // Without stale-socket cleanup the bind emits EADDRINUSE and the server
    // never accepts; with it, a client can connect + drive a request through.
    server.listen();
    try {
      const client = net.connect(sockPath);
      await new Promise<void>((resolve, reject) => {
        client.on('connect', resolve);
        client.on('error', reject);
      });
      client.write(
        `${JSON.stringify({
          kind: 'act.request',
          id: 'wire-stale',
          payload: {
            tool: 'execute_action',
            sessionId: 's',
            action: { type: 'click', selector: '#x', button: 'left' },
            client: 'cursor',
          },
        })}\n`,
      );
      for (let i = 0; i < 50 && posted === undefined; i++) {
        await new Promise((r) => setTimeout(r, 5));
      }
      client.end();
      expect((posted as { requestId?: string } | undefined)?.requestId).toBe('rid-stale');
    } finally {
      server.close();
      prior.close();
    }
  });
});
