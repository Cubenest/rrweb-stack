// Native-host-side IPC relay (Task 3.24 IPC layer).
//
// The MCP-server process talks to this server over the local socket
// (`~/.peek/host.sock`) using the {@link LocalSocketHostBridge}. This server
// runs INSIDE the native-host process — the one that owns the
// `chrome.runtime.connectNative` port to the service worker. It relays:
//
//   socket  act.request   →  native-port  action.request   (host → SW)
//   native-port action.result / action.confirm.shown  →  socket act.response
//
// Correlation has TWO id spaces that must not be conflated:
//   • the socket wire `id` (the LocalSocketHostBridge's RequestRegistry id) —
//     the MCP process correlates `act.response` back to its awaiting tool call.
//   • the native-port `requestId` (UUID) — the SW echoes it on its reply so we
//     find the originating socket connection.
// We hold a `Map<requestId, { conn, wireId }>` so an `action.result` resolves
// to the right connection AND echoes the right wire id.
//
// Security / robustness: per-connection newline-JSON framing (reused shape from
// the bridge); a malformed frame is dropped, never crashes the loop; an
// `action.result` for an unknown requestId is dropped (a stale reply after a
// timeout must not throw). The policy deltas are loaded per request (the file
// is tiny) and forwarded so the SW's destructive matcher merges them.

import { mkdirSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import * as net from 'node:net';
import { platform } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { peekHomeDir } from '../db/open.js';
import type {
  ActionConfirmShownMessage,
  ActionRequestMessage,
  ActionResultMessage,
} from './action-protocol.js';
import { type LoadedPolicy, loadPolicy } from './policy.js';
import { hostSocketPath } from './socket-path.js';

/**
 * Item E + I: unlink a Unix-domain-socket file ONLY when it's safe to do so —
 * the path is a socket inode (never a regular file the user owns). This is the
 * pure filesystem guard; the LIVE-vs-stale decision (item I) is made by the
 * caller via {@link probeSocketAlive} BEFORE calling this, because the mere
 * existence of a socket inode does NOT mean it's stale — a live host could be
 * listening on it. Clobbering a live host's socket would silently break it.
 *
 * A missing path is a no-op. Windows named pipes aren't filesystem paths, so
 * this is skipped there. Best-effort: any stat/unlink error is swallowed.
 */
export function cleanupStaleSocket(path: string): void {
  if (platform() === 'win32') return; // named pipe — not a filesystem inode
  try {
    const st = statSync(path);
    if (!st.isSocket()) return; // never clobber a regular file / dir
    unlinkSync(path);
  } catch {
    // ENOENT (nothing there) or any other stat/unlink error — leave it for the
    // bind to report. Don't throw; cleanup is best-effort.
  }
}

/**
 * Item I: probe whether a LIVE server is listening at `path`. Connects with a
 * short timeout: a successful connect → a live host owns the socket (do NOT
 * unlink it); a refused/ENOENT/timeout → the inode is stale (safe to unlink and
 * retry the bind). Windows named pipes are probed the same way (net.connect
 * accepts the pipe path). Resolves false on any error so a probe failure can't
 * wedge startup.
 */
export function probeSocketAlive(path: string, timeoutMs = 500): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    let settled = false;
    const done = (alive: boolean) => {
      if (settled) return;
      settled = true;
      try {
        client.destroy();
      } catch {
        // ignore
      }
      resolve(alive);
    };
    const client = net.connect(path);
    client.setTimeout?.(timeoutMs);
    client.on('connect', () => done(true)); // a live server accepted us
    client.on('error', () => done(false)); // ECONNREFUSED / ENOENT → stale
    client.on('timeout', () => done(false));
  });
}

/** Minimal duplex surface a connection must provide — injectable for tests. */
export interface ConnectionLike {
  write(data: string): void;
  on(ev: string, h: (...a: unknown[]) => void): void;
  /** Optional: forcibly close the connection (item J — over-cap line drop). */
  destroy?(): void;
  /** Optional: gracefully end the connection (fallback when destroy is absent). */
  end?(): void;
}

/** Minimal server surface — injectable for tests (real impl is net.Server). */
export interface NetServerLike {
  listen(): void;
  close(): void;
  /**
   * Item I: subscribe to the server's async 'error' event (EADDRINUSE/EACCES are
   * emitted here, NOT thrown from listen()). Optional so existing fakes that
   * never error don't need it.
   */
  on?(ev: 'error', handler: (err: Error & { code?: string }) => void): void;
}

/** Default cap for a single inbound newline-delimited frame (item J). 1 MiB. */
const DEFAULT_MAX_LINE_BYTES = 1024 * 1024;

export interface HostSocketServerDeps {
  /** Forward an `action.request` to the SW over the native port. */
  postToSw(message: ActionRequestMessage): void;
  /** Read ~/.peek/policy.json (per request — cheap). Defaults to {@link loadPolicy}. */
  loadPolicy?: () => LoadedPolicy;
  /** Generate a fresh native-port requestId. Defaults to crypto.randomUUID. */
  generateRequestId?: () => string;
  /** Override the socket / named-pipe path. */
  socketPath?: string;
  /**
   * Build the underlying server given the per-connection handler. Defaults to
   * `net.createServer`; tests inject a fake that drives connections directly.
   */
  createServer?: (onConnection: (conn: ConnectionLike) => void) => NetServerLike;
  /**
   * Item J: max bytes for a single inbound line before the connection is
   * dropped. Defaults to 1 MiB (matches the bridge side).
   */
  maxLineBytes?: number;
  /**
   * Item I: probe whether a LIVE server owns the socket path. Defaults to
   * {@link probeSocketAlive}; injectable so the bind-failure policy is testable.
   */
  probeSocketAlive?: (path: string) => Promise<boolean>;
  /**
   * Item I: unlink the (confirmed-stale) socket inode. Defaults to
   * {@link cleanupStaleSocket}; injectable for tests.
   */
  unlinkSocket?: (path: string) => void;
  /**
   * Item I: called when the socket fails to bind even after the stale-unlink
   * retry (e.g. a LIVE owner, or EACCES). The caller (startNativeHost) uses
   * this to degrade — set `socketServer = undefined` — instead of crashing.
   */
  onListenError?: (err: Error) => void;
  /**
   * Spill a decoded screenshot PNG to disk and return its on-disk pointer.
   * Defaults to {@link writeScreenshotFile} (writes `~/.peek/screenshots/
   * <requestId>.png`, 0600). Injectable so tests can assert the fs path is
   * taken ONLY for a screenshot reply (zero calls otherwise).
   */
  writeScreenshot?: (requestId: string, buf: Buffer) => { path: string; bytes: number };
}

/**
 * Default screenshot spill-to-disk: write the decoded PNG under
 * `~/.peek/screenshots/<requestId>.png` with 0600 perms (mirrors the ingest.ts
 * blob-write precedent) and return its `{ path, bytes }`. Kept as a standalone
 * export so the {@link HostSocketServer} can inject a fake in tests.
 */
export function writeScreenshotFile(
  requestId: string,
  buf: Buffer,
): { path: string; bytes: number } {
  const dir = join(peekHomeDir(), 'screenshots');
  mkdirSync(dir, { recursive: true });
  const path = join(dir, `${requestId}.png`);
  writeFileSync(path, buf, { mode: 0o600 });
  return { path, bytes: buf.length };
}

/** Per in-flight request: which connection issued it + its socket wire id. */
interface InFlight {
  conn: ConnectionLike;
  /** The `id` from the originating `act.request` frame (the bridge's id). */
  wireId: string;
}

/**
 * Map a terminal {@link ActionResultMessage} to the wire `payload` the bridge
 * expects (a {@link HostActionResponse}). Drops the wire-protocol envelope
 * fields (`type`, `requestId`, `tool`) and keeps the verdict/result data —
 * INCLUDING `confirmToken` when the SW issued one (request_authorization).
 *
 * SCREENSHOT SPILL-TO-DISK: a `screenshot` action's `details.dataUrl` is a
 * base64 PNG that can be megabytes — far too large to round-trip back to the
 * MCP client over the socket as inline JSON. This is the single chokepoint
 * every `action.result` flows through, so we spill it to disk HERE: write the
 * decoded PNG under `~/.peek/screenshots/<requestId>.png` (0600, mirroring the
 * ingest.ts blob-write precedent) and REPLACE `details` with a compact
 * `{ path, bytes, format }` pointer.
 *
 * STRICT GUARD: the fs path (`writeScreenshot`) is invoked ONLY when
 * `details.dataUrl` is present. Every non-screenshot reply passes through
 * byte-for-byte with ZERO fs calls.
 */
function toResponsePayload(
  result: ActionResultMessage,
  writeScreenshot: (requestId: string, buf: Buffer) => { path: string; bytes: number },
): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    verdict: result.verdict,
    result: result.result,
    approver: result.approver,
  };
  if (result.approvalMs !== undefined) payload.approvalMs = result.approvalMs;
  if (result.destructiveTerm !== undefined) payload.destructiveTerm = result.destructiveTerm;
  if (result.details !== undefined) payload.details = result.details;
  if (result.error !== undefined) payload.error = result.error;
  if (result.confirmToken !== undefined) payload.confirmToken = result.confirmToken;

  // Spill a screenshot dataUrl to disk (see doc comment). Guarded so any other
  // reply shape — including a `details` object WITHOUT `dataUrl` — is untouched
  // and makes ZERO fs calls (writeScreenshot is never invoked).
  const details = result.details as { dataUrl?: unknown } | null | undefined;
  if (details && typeof details.dataUrl === 'string') {
    const b64 = details.dataUrl.replace(/^data:image\/png;base64,/, '');
    const buf = Buffer.from(b64, 'base64');
    const { path, bytes } = writeScreenshot(result.requestId, buf);
    payload.details = { path, bytes, format: 'png' };
  }
  return payload;
}

export class HostSocketServer {
  readonly #deps: Required<Omit<HostSocketServerDeps, 'socketPath' | 'onListenError'>> & {
    socketPath: string;
    onListenError?: (err: Error) => void;
  };
  readonly #inFlight = new Map<string, InFlight>();
  #server: NetServerLike | undefined;
  /** Whether we've already done the one stale-unlink retry (item I). */
  #retriedAfterUnlink = false;

  constructor(deps: HostSocketServerDeps) {
    this.#deps = {
      postToSw: deps.postToSw,
      loadPolicy: deps.loadPolicy ?? (() => loadPolicy()),
      generateRequestId: deps.generateRequestId ?? (() => globalThis.crypto.randomUUID()),
      socketPath: deps.socketPath ?? hostSocketPath(),
      maxLineBytes: deps.maxLineBytes ?? DEFAULT_MAX_LINE_BYTES,
      probeSocketAlive: deps.probeSocketAlive ?? ((p) => probeSocketAlive(p)),
      unlinkSocket: deps.unlinkSocket ?? ((p) => cleanupStaleSocket(p)),
      writeScreenshot: deps.writeScreenshot ?? ((id, buf) => writeScreenshotFile(id, buf)),
      ...(deps.onListenError ? { onListenError: deps.onListenError } : {}),
      createServer:
        deps.createServer ??
        ((onConnection) => {
          const server = net.createServer((socket) => {
            socket.setEncoding('utf8');
            onConnection(socket as unknown as ConnectionLike);
          });
          let errorHandler: ((err: Error & { code?: string }) => void) | undefined;
          server.on('error', (err) => errorHandler?.(err as Error & { code?: string }));
          return {
            // Item I: do NOT blindly unlink before binding (that could clobber a
            // LIVE host's socket). Bind directly; if it emits EADDRINUSE the
            // listen() orchestration probes live-vs-stale and only then unlinks.
            listen: () => server.listen(this.#deps.socketPath),
            close: () => server.close(),
            on: (_ev, handler) => {
              errorHandler = handler;
            },
          };
        }),
    };
  }

  /**
   * Start listening for MCP-process connections. Item I: bind failures
   * (EADDRINUSE/EACCES) surface ASYNC via the server 'error' event, not a throw,
   * so we attach an error handler and run the stale-vs-live policy:
   *   • EADDRINUSE + probe says LIVE → another host owns it: report + stay down.
   *   • EADDRINUSE + probe says stale → unlink + retry listen ONCE.
   *   • any other bind error (e.g. EACCES) or a second EADDRINUSE → report + down.
   * "Report" calls onListenError so startNativeHost degrades gracefully.
   */
  listen(): void {
    if (this.#server) return;
    const server = this.#deps.createServer((conn) => this.#onConnection(conn));
    this.#server = server;
    server.on?.('error', (err) => {
      void this.#handleListenError(err);
    });
    server.listen();
  }

  async #handleListenError(err: Error & { code?: string }): Promise<void> {
    // Only EADDRINUSE is recoverable via the stale-unlink dance; everything else
    // (EACCES, etc.) is reported as-is.
    if (err.code !== 'EADDRINUSE' || this.#retriedAfterUnlink) {
      this.#reportListenFailure(err);
      return;
    }
    const alive = await this.#deps.probeSocketAlive(this.#deps.socketPath).catch(() => false);
    if (alive) {
      // A live host already owns this socket — DO NOT clobber it. Degrade.
      this.#reportListenFailure(err);
      return;
    }
    // Stale inode: unlink it and retry the bind exactly once.
    this.#retriedAfterUnlink = true;
    this.#deps.unlinkSocket(this.#deps.socketPath);
    // A short beat so the unlink settles before rebind (mostly belt-and-braces).
    await delay(0);
    this.#server?.listen();
  }

  #reportListenFailure(err: Error): void {
    this.#server = undefined;
    this.#deps.onListenError?.(err);
  }

  /** Stop the server (best-effort). */
  close(): void {
    this.#server?.close();
    this.#server = undefined;
    this.#inFlight.clear();
  }

  /**
   * Inbound from the SW over the native port. For a terminal `action.result`,
   * find the originating connection by requestId and write back the mapped
   * `act.response`. `action.confirm.shown` is a non-terminal timing signal —
   * the verdict still arrives in a later `action.result` — so we drop it here.
   */
  onSwMessage(message: ActionResultMessage | ActionConfirmShownMessage): void {
    if (message.type !== 'action.result') return; // confirm.shown: timing only
    const inFlight = this.#inFlight.get(message.requestId);
    if (!inFlight) return; // stale reply after a timeout — drop, don't throw
    this.#inFlight.delete(message.requestId);
    const frame = {
      kind: 'act.response',
      id: inFlight.wireId,
      payload: toResponsePayload(message, this.#deps.writeScreenshot),
    };
    try {
      inFlight.conn.write(`${JSON.stringify(frame)}\n`);
    } catch {
      // The MCP process closed the socket mid-flight; its tool call will time
      // out. Nothing else to do here.
    }
  }

  #onConnection(conn: ConnectionLike): void {
    let buf = '';
    let dropped = false;
    conn.on('data', (chunk: unknown) => {
      if (dropped) return; // connection already torn down for an over-cap line
      buf += String(chunk);
      // Item J: local-DoS guard (mirrors the bridge). If the buffer grows past
      // the cap WITHOUT a frame delimiter, a hostile/malformed peer is trying to
      // make us buffer unbounded — drop the connection + clear the buffer.
      if (buf.length > this.#deps.maxLineBytes && buf.indexOf('\n') < 0) {
        dropped = true;
        buf = '';
        try {
          conn.destroy?.();
          conn.end?.();
        } catch {
          // best-effort teardown
        }
        return;
      }
      let nl: number;
      // biome-ignore lint/suspicious/noAssignInExpressions: idiomatic frame-drain loop
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl);
        buf = buf.slice(nl + 1);
        if (!line.trim()) continue;
        if (line.length > this.#deps.maxLineBytes) continue; // oversized framed line — drop it
        this.#handleFrame(conn, line);
      }
    });
    // A connection error / close leaves any of its in-flight entries dangling;
    // they'll never be resolved (the MCP tool call times out). Drop them so the
    // map doesn't grow unbounded.
    const drop = () => {
      for (const [requestId, entry] of this.#inFlight.entries()) {
        if (entry.conn === conn) this.#inFlight.delete(requestId);
      }
    };
    conn.on('error', drop);
    conn.on('close', drop);
    conn.on('end', drop);
  }

  #handleFrame(conn: ConnectionLike, line: string): void {
    let frame: { kind?: string; id?: string; payload?: unknown };
    try {
      frame = JSON.parse(line);
    } catch {
      return; // malformed — drop, keep the loop alive
    }
    if (frame.kind !== 'act.request' || typeof frame.id !== 'string') return;
    const payload = frame.payload as
      | {
          tool?: 'execute_action' | 'request_authorization';
          sessionId?: string;
          action?: ActionRequestMessage['action'];
          client?: string;
          tabId?: number;
          confirmToken?: string;
        }
      | undefined;
    if (!payload || payload.tool === undefined || payload.action === undefined) return;

    const requestId = this.#deps.generateRequestId();
    this.#inFlight.set(requestId, { conn, wireId: frame.id });

    const policy = this.#deps.loadPolicy().destructiveTerms;
    const request: ActionRequestMessage = {
      type: 'action.request',
      requestId,
      tool: payload.tool,
      sessionId: payload.sessionId ?? '',
      action: payload.action,
      client: payload.client ?? 'unknown',
      policy: { add: policy.add, remove: policy.remove },
      ...(payload.tabId !== undefined ? { tabId: payload.tabId } : {}),
      ...(payload.confirmToken !== undefined ? { confirmToken: payload.confirmToken } : {}),
    };
    this.#deps.postToSw(request);
  }
}
