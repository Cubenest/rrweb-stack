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

import * as net from 'node:net';
import type {
  ActionConfirmShownMessage,
  ActionRequestMessage,
  ActionResultMessage,
} from './action-protocol.js';
import { type LoadedPolicy, loadPolicy } from './policy.js';
import { hostSocketPath } from './socket-path.js';

/** Minimal duplex surface a connection must provide — injectable for tests. */
export interface ConnectionLike {
  write(data: string): void;
  on(ev: string, h: (...a: unknown[]) => void): void;
}

/** Minimal server surface — injectable for tests (real impl is net.Server). */
export interface NetServerLike {
  listen(): void;
  close(): void;
}

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
 */
function toResponsePayload(result: ActionResultMessage): Record<string, unknown> {
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
  return payload;
}

export class HostSocketServer {
  readonly #deps: Required<Omit<HostSocketServerDeps, 'socketPath'>> & { socketPath: string };
  readonly #inFlight = new Map<string, InFlight>();
  #server: NetServerLike | undefined;

  constructor(deps: HostSocketServerDeps) {
    this.#deps = {
      postToSw: deps.postToSw,
      loadPolicy: deps.loadPolicy ?? (() => loadPolicy()),
      generateRequestId: deps.generateRequestId ?? (() => globalThis.crypto.randomUUID()),
      socketPath: deps.socketPath ?? hostSocketPath(),
      createServer:
        deps.createServer ??
        ((onConnection) => {
          const server = net.createServer((socket) => {
            socket.setEncoding('utf8');
            onConnection(socket as unknown as ConnectionLike);
          });
          return {
            listen: () => server.listen(this.#deps.socketPath),
            close: () => server.close(),
          };
        }),
    };
  }

  /** Start listening for MCP-process connections. */
  listen(): void {
    if (this.#server) return;
    this.#server = this.#deps.createServer((conn) => this.#onConnection(conn));
    this.#server.listen();
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
      payload: toResponsePayload(message),
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
    conn.on('data', (chunk: unknown) => {
      buf += String(chunk);
      let nl: number;
      // biome-ignore lint/suspicious/noAssignInExpressions: idiomatic frame-drain loop
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl);
        buf = buf.slice(nl + 1);
        if (!line.trim()) continue;
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
