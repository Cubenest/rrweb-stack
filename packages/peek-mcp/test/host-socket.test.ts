import { EventEmitter } from 'node:events';
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import * as net from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  HostSocketServer,
  cleanupStaleSocket,
  probeSocketAlive,
  rebindRetryDelayMs,
} from '../src/native-host/host-socket.js';
import { EMPTY_POLICY, type LoadedPolicy } from '../src/native-host/policy.js';

/**
 * A fake connection: collects bytes written to it (the "client" side reads
 * these) and lets the test push inbound frames (the "client" side wrote them).
 * Mirrors the real `net.Socket` duplex surface the server consumes.
 */
class FakeConnection extends EventEmitter {
  written: string[] = [];
  destroyed = 0;
  ended = 0;
  write(data: string): void {
    this.written.push(data);
  }
  destroy(): void {
    this.destroyed += 1;
  }
  end(): void {
    this.ended += 1;
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
  maxLineBytes?: number;
  writeScreenshot?: (requestId: string, buf: Buffer) => { path: string; bytes: number };
}) {
  const posted: unknown[] = [];
  const net = new FakeNetServer();
  const idQueue = overrides?.ids ? [...overrides.ids] : ['rid-1', 'rid-2', 'rid-3'];
  let n = 0;
  const server = new HostSocketServer({
    postToSw: overrides?.postToSw ?? ((m) => posted.push(m)),
    loadPolicy: overrides?.loadPolicy ?? (() => EMPTY_POLICY),
    generateRequestId: () => idQueue[n++] ?? `rid-${n}`,
    ...(overrides?.maxLineBytes !== undefined ? { maxLineBytes: overrides.maxLineBytes } : {}),
    ...(overrides?.writeScreenshot !== undefined
      ? { writeScreenshot: overrides.writeScreenshot }
      : {}),
    createServer: (handler) => {
      net.onConnection(handler);
      return net as never;
    },
  });
  server.listen();
  return { server, net, posted };
}

/** A 1x1 transparent PNG, base64 (the smallest valid PNG payload). */
const PNG_1X1_B64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

/** Feed an act.request so an `act.response` written for `rid` lands on `conn`. */
function feedScreenshotRequest(conn: FakeConnection): void {
  conn.feed(
    `${JSON.stringify({
      kind: 'act.request',
      id: 'wire-shot',
      payload: {
        tool: 'execute_action',
        sessionId: 's',
        action: { type: 'screenshot' },
        client: 'cursor',
      },
    })}\n`,
  );
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

  it('forwards consentDelegated from the wire frame to the SW request (SP3b)', () => {
    const { net, posted } = makeServer();
    const conn = net.connect();
    conn.feed(
      `${JSON.stringify({
        kind: 'act.request',
        id: 'wire-cd',
        payload: {
          tool: 'execute_action',
          sessionId: 's',
          action: { type: 'click', selector: '#x', button: 'left' },
          client: 'slack',
          consentDelegated: true,
        },
      })}\n`,
    );
    expect((posted[0] as Record<string, unknown>).consentDelegated).toBe(true);
  });

  it('omits consentDelegated when the frame does not set it', () => {
    const { net, posted } = makeServer();
    const conn = net.connect();
    conn.feed(
      `${JSON.stringify({
        kind: 'act.request',
        id: 'wire-nocd',
        payload: {
          tool: 'execute_action',
          sessionId: 's',
          action: { type: 'click', selector: '#x', button: 'left' },
          client: 'cursor',
        },
      })}\n`,
    );
    expect('consentDelegated' in (posted[0] ?? {})).toBe(false);
  });

  it('forwards connectorSecret from the wire frame to the SW request (SP4)', () => {
    const { net, posted } = makeServer();
    const conn = net.connect();
    conn.feed(
      `${JSON.stringify({
        kind: 'act.request',
        id: 'wire-cs',
        payload: {
          tool: 'execute_action',
          sessionId: 's',
          action: { type: 'click', selector: '#x', button: 'left' },
          client: 'slack',
          connectorSecret: 'sek',
        },
      })}\n`,
    );
    expect((posted[0] as Record<string, unknown>).connectorSecret).toBe('sek');
  });

  it('omits connectorSecret when the frame does not set it (SP4)', () => {
    const { net, posted } = makeServer();
    const conn = net.connect();
    conn.feed(
      `${JSON.stringify({
        kind: 'act.request',
        id: 'wire-nocs',
        payload: {
          tool: 'execute_action',
          sessionId: 's',
          action: { type: 'click', selector: '#x', button: 'left' },
          client: 'cursor',
        },
      })}\n`,
    );
    expect('connectorSecret' in (posted[0] ?? {})).toBe(false);
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

  // Item J: cap a single inbound unframed line on the SERVER side (matching the
  // bridge). A malformed/hostile peer that streams bytes without a newline must
  // not make the server buffer unbounded — drop/close the connection.
  it('drops the connection when one unframed inbound line exceeds the cap', () => {
    const { net, posted } = makeServer({ maxLineBytes: 100 });
    const conn = net.connect();
    // 500 bytes, no newline → blows the 100-byte cap.
    conn.feed('a'.repeat(500));
    // Nothing was posted (no complete frame) and the connection was torn down.
    expect(posted).toHaveLength(0);
    expect(conn.destroyed + conn.ended).toBeGreaterThan(0);
    // Subsequent bytes on the dropped connection are ignored (buffer cleared).
    conn.feed(
      `${JSON.stringify({
        kind: 'act.request',
        id: 'late',
        payload: {
          tool: 'execute_action',
          sessionId: 's',
          action: { type: 'click', selector: '#x', button: 'left' },
          client: 'cursor',
        },
      })}\n`,
    );
    expect(posted).toHaveLength(0);
  });

  it('still relays a normal-sized framed request under the cap', () => {
    const { net, posted } = makeServer({ maxLineBytes: 4096 });
    const conn = net.connect();
    conn.feed(
      `${JSON.stringify({
        kind: 'act.request',
        id: 'wire-ok',
        payload: {
          tool: 'execute_action',
          sessionId: 's',
          action: { type: 'click', selector: '#x', button: 'left' },
          client: 'cursor',
        },
      })}\n`,
    );
    expect(posted).toHaveLength(1);
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

// SCREENSHOT SPILL-TO-DISK: a screenshot `details.dataUrl` is decoded + written
// to ~/.peek/screenshots/<requestId>.png and REPLACED with a compact pointer so
// a multi-MB base64 PNG never round-trips over the socket. STRICT GUARD: any
// reply WITHOUT a dataUrl passes through byte-for-byte with ZERO fs calls.
describe('rebindRetryDelayMs', () => {
  it('waits a beat before retrying a Windows named-pipe rebind (it needs time to release)', () => {
    expect(rebindRetryDelayMs('\\\\.\\pipe\\peek-host')).toBeGreaterThan(0);
  });
  it('rebinds a POSIX socket immediately after unlink (no extra delay)', () => {
    expect(rebindRetryDelayMs('/home/u/.peek/host.sock')).toBe(0);
  });
});

describe('HostSocketServer — screenshot spill-to-disk (toResponsePayload)', () => {
  it('writes the PNG + returns { path, bytes, format } and DROPS dataUrl when present', () => {
    const calls: Array<{ requestId: string; bytes: number }> = [];
    const { server, net } = makeServer({
      writeScreenshot: (requestId, buf) => {
        calls.push({ requestId, bytes: buf.length });
        return { path: `/fake/screenshots/${requestId}.png`, bytes: buf.length };
      },
    });
    const conn = net.connect();
    feedScreenshotRequest(conn);

    const rawBytes = Buffer.from(PNG_1X1_B64, 'base64').length;
    server.onSwMessage({
      type: 'action.result',
      requestId: 'rid-1',
      tool: 'execute_action',
      verdict: 'allow',
      result: 'ok',
      approver: 'user',
      details: {
        dataUrl: `data:image/png;base64,${PNG_1X1_B64}`,
        format: 'png',
        selectorCropped: false,
      },
    });

    // The injected writer ran exactly once with the decoded PNG bytes.
    expect(calls).toEqual([{ requestId: 'rid-1', bytes: rawBytes }]);

    const payload = conn.frames()[0]?.payload as Record<string, unknown>;
    const details = payload.details as Record<string, unknown>;
    expect(details).toEqual({
      path: '/fake/screenshots/rid-1.png',
      bytes: rawBytes,
      format: 'png',
    });
    // The fat base64 dataUrl never makes it onto the wire.
    expect('dataUrl' in details).toBe(false);
  });

  it('writes a clean error act.response (no crash/timeout) when the screenshot write fails', () => {
    // EACCES on ~/.peek/screenshots, disk full, etc. Must NOT throw out of
    // onSwMessage — that skips the act.response and times the caller out.
    const { server, net } = makeServer({
      writeScreenshot: () => {
        throw Object.assign(new Error('EACCES: permission denied'), { code: 'EACCES' });
      },
    });
    const conn = net.connect();
    feedScreenshotRequest(conn);

    expect(() =>
      server.onSwMessage({
        type: 'action.result',
        requestId: 'rid-1',
        tool: 'execute_action',
        verdict: 'allow',
        result: 'ok',
        approver: 'user',
        details: { dataUrl: `data:image/png;base64,${PNG_1X1_B64}`, format: 'png' },
      }),
    ).not.toThrow();

    const frames = conn.frames();
    expect(frames).toHaveLength(1); // a response WAS written back
    expect(frames[0]?.kind).toBe('act.response');
    const payload = frames[0]?.payload as Record<string, unknown>;
    expect(payload.verdict).toBe('allow'); // the action itself still succeeded
    const details = payload.details as Record<string, unknown>;
    expect('dataUrl' in details).toBe(false); // never inline the multi-MB base64
    expect(details.format).toBe('png');
    expect(String(details.error)).toMatch(/EACCES|screenshot/i);
  });

  it('STRICT GUARD: a non-screenshot reply passes through with ZERO fs calls', () => {
    let writeCalls = 0;
    const { server, net } = makeServer({
      writeScreenshot: (requestId, buf) => {
        writeCalls += 1;
        return { path: `/fake/${requestId}.png`, bytes: buf.length };
      },
    });
    const conn = net.connect();
    conn.feed(
      `${JSON.stringify({
        kind: 'act.request',
        id: 'wire-click',
        payload: {
          tool: 'execute_action',
          sessionId: 's',
          action: { type: 'click', selector: '#x', button: 'left' },
          client: 'cursor',
        },
      })}\n`,
    );
    // A click reply carrying a details object WITHOUT a dataUrl — must be
    // untouched and trigger ZERO fs writes.
    server.onSwMessage({
      type: 'action.result',
      requestId: 'rid-1',
      tool: 'execute_action',
      verdict: 'allow',
      result: 'ok',
      approver: 'user',
      details: { dispatched: true, matched: true },
    });
    expect(writeCalls).toBe(0); // the spy was NEVER invoked
    const payload = conn.frames()[0]?.payload as Record<string, unknown>;
    expect(payload.details).toEqual({ dispatched: true, matched: true }); // byte-for-byte
  });

  it('default writeScreenshot writes a 0600 PNG under PEEK_HOME/screenshots', () => {
    const home = mkdtempSync(join(tmpdir(), 'peek-shot-'));
    const prevHome = process.env.PEEK_HOME;
    process.env.PEEK_HOME = home;
    try {
      // No writeScreenshot override → exercises the real writeScreenshotFile.
      const { server, net } = makeServer();
      const conn = net.connect();
      feedScreenshotRequest(conn);
      server.onSwMessage({
        type: 'action.result',
        requestId: 'rid-1',
        tool: 'execute_action',
        verdict: 'allow',
        result: 'ok',
        approver: 'user',
        details: { dataUrl: `data:image/png;base64,${PNG_1X1_B64}`, format: 'png' },
      });
      const details = (conn.frames()[0]?.payload as Record<string, unknown>).details as Record<
        string,
        unknown
      >;
      const path = details.path as string;
      expect(path).toBe(join(home, 'screenshots', 'rid-1.png'));
      expect(existsSync(path)).toBe(true);
      // The file is the decoded PNG bytes, not the base64 text.
      expect(readFileSync(path)).toEqual(Buffer.from(PNG_1X1_B64, 'base64'));
      if (process.platform !== 'win32') {
        expect(statSync(path).mode & 0o777).toBe(0o600);
      }
    } finally {
      if (prevHome === undefined) {
        process.env.PEEK_HOME = undefined;
        // biome-ignore lint/performance/noDelete: restore a truly-absent env var
        delete process.env.PEEK_HOME;
      } else {
        process.env.PEEK_HOME = prevHome;
      }
      rmSync(home, { recursive: true, force: true });
    }
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

  it('probeSocketAlive resolves true for a LIVE server, false for a refused/absent path', async () => {
    const sockPath = join(dir, 'live.sock');
    const prior = await bindStaleSocket(sockPath);
    try {
      // A real listener answers the probe → owned by a live host.
      await expect(probeSocketAlive(sockPath)).resolves.toBe(true);
    } finally {
      prior.close();
    }
    // Nothing listening at this path → not alive (stale / never existed).
    await expect(probeSocketAlive(join(dir, 'absent.sock'))).resolves.toBe(false);
  });
});

// Items I + J: a bind failure (EADDRINUSE/EACCES) is emitted ASYNC via the
// server 'error' event, NOT thrown — so a plain try/catch around listen() can't
// catch it. The server must surface bind failures via an onError callback and
// follow the stale-vs-live probe policy:
//   • stale socket (probe refused/dead) → unlink + retry listen once.
//   • LIVE socket (probe answers — another host owns it) → do NOT unlink;
//     report the error so startNativeHost degrades (socketServer = undefined).
// We inject a fake server + probe so the policy is deterministic.
describe('HostSocketServer.listen — async bind-failure handling (items I/J)', () => {
  /** A fake server whose listen() can be told to emit EADDRINUSE once. */
  class FakeBindServer {
    listenCalls = 0;
    closed = 0;
    #onError: ((err: Error) => void) | undefined;
    constructor(
      readonly failPlan: Array<'EADDRINUSE' | 'ok'>,
      readonly onListen?: () => void,
    ) {}
    on(ev: string, h: (err: Error) => void): void {
      if (ev === 'error') this.#onError = h;
    }
    listen(): void {
      const outcome = this.failPlan[this.listenCalls] ?? 'ok';
      this.listenCalls += 1;
      if (outcome === 'EADDRINUSE') {
        const err = new Error('bind EADDRINUSE') as Error & { code?: string };
        err.code = 'EADDRINUSE';
        // Async, like the real server 'error' event.
        queueMicrotask(() => this.#onError?.(err));
      } else {
        this.onListen?.();
      }
    }
    close(): void {
      this.closed += 1;
    }
  }

  it('LIVE socket on EADDRINUSE → reports error, does NOT unlink, leaves the server down', async () => {
    let unlinked = false;
    let reported: Error | undefined;
    const fake = new FakeBindServer(['EADDRINUSE']);
    const server = new HostSocketServer({
      postToSw: () => {},
      loadPolicy: () => EMPTY_POLICY,
      socketPath: '/tmp/peek-fake.sock',
      createServer: () => fake as never,
      // A live owner answers the probe.
      probeSocketAlive: async () => true,
      unlinkSocket: () => {
        unlinked = true;
      },
      onListenError: (err) => {
        reported = err;
      },
    });
    server.listen();
    await new Promise((r) => setTimeout(r, 10));
    expect(reported).toBeInstanceOf(Error); // surfaced to the caller (degrade)
    expect(unlinked).toBe(false); // never clobber a live host's socket
    expect(fake.listenCalls).toBe(1); // no retry against a live owner
  });

  it('STALE socket on EADDRINUSE → unlinks + retries listen once, then succeeds', async () => {
    let unlinked = false;
    let reported: Error | undefined;
    let listened = 0;
    const fake = new FakeBindServer(['EADDRINUSE', 'ok'], () => {
      listened += 1;
    });
    const server = new HostSocketServer({
      postToSw: () => {},
      loadPolicy: () => EMPTY_POLICY,
      socketPath: '/tmp/peek-fake.sock',
      createServer: () => fake as never,
      // No live owner → the inode is stale.
      probeSocketAlive: async () => false,
      unlinkSocket: () => {
        unlinked = true;
      },
      onListenError: (err) => {
        reported = err;
      },
    });
    server.listen();
    await new Promise((r) => setTimeout(r, 10));
    expect(unlinked).toBe(true); // stale inode removed
    expect(fake.listenCalls).toBe(2); // retried once
    expect(listened).toBe(1); // second listen succeeded
    expect(reported).toBeUndefined(); // recovered — no error surfaced
  });

  it('a SECOND EADDRINUSE after unlink+retry → reports error (gives up, no infinite loop)', async () => {
    let reported: Error | undefined;
    const fake = new FakeBindServer(['EADDRINUSE', 'EADDRINUSE']);
    const server = new HostSocketServer({
      postToSw: () => {},
      loadPolicy: () => EMPTY_POLICY,
      socketPath: '/tmp/peek-fake.sock',
      createServer: () => fake as never,
      probeSocketAlive: async () => false,
      unlinkSocket: () => {},
      onListenError: (err) => {
        reported = err;
      },
    });
    server.listen();
    await new Promise((r) => setTimeout(r, 10));
    expect(fake.listenCalls).toBe(2); // retried exactly once
    expect(reported).toBeInstanceOf(Error); // gave up cleanly
  });
});
