// Native messaging host runner (ADR-0007). Spawned by the browser over stdio
// (via the manifest's `path`, with the calling extension's origin as an
// argument) or manually with `--native-host`. It owns ~/.peek/sessions.db and
// reads length-prefixed JSON messages from the extension.
//
// Phase 3a wired the transport + DB open and a minimal handshake so the channel
// is verifiable end-to-end; Phase 3d chunk 4 closes the loop with the four
// ingest handlers in `./ingest.ts` (session.append / console.append /
// network.append / shadow.report). The act-tool action-protocol dispatch
// (request/result correlation through the SW) lands alongside the IPC bridge.

import type { Readable, Writable } from 'node:stream';
import { openDb, peekHomeDir, schemaVersion } from '../db/open.js';
import type {
  ActionConfirmShownMessage,
  ActionResultMessage,
  PairResultMessage,
} from './action-protocol.js';
import { HostSocketServer } from './host-socket.js';
import { type IncomingMessage, ingest } from './ingest.js';
import { hostSocketPath } from './socket-path.js';
import { readMessages, writeMessage } from './transport.js';

export interface NativeHostHandle {
  /** Resolves when stdin closes (the browser disconnected the port). */
  readonly done: Promise<void>;
  /** Close the SQLite connection. */
  close(): void;
}

export interface NativeHostOptions {
  /**
   * The `chrome-extension://<id>/` origin Chrome/Edge passed when spawning the
   * host — identifies which extension connected. Captured now for the
   * audit_log in Phase 3d; surfaced in the `host.hello` reply.
   */
  readonly callerOrigin?: string;
  /** Override PEEK_HOME for tests (default: env / homedir). */
  readonly home?: string;
  /** Override the database path (e.g. ':memory:' for tests). */
  readonly dbPath?: string;
  /** Override the input stream (default: process.stdin). */
  readonly input?: Readable;
  /** Override the output stream (default: process.stdout). */
  readonly output?: Writable;
  /**
   * Override the IPC socket / named-pipe path the {@link HostSocketServer}
   * listens on (tests + alternate PEEK_HOME). Defaults to ~/.peek/host.sock.
   */
  readonly socketPath?: string;
  /**
   * When false, skip starting the {@link HostSocketServer}. Defaults to true.
   * Tests that only exercise the ingest/handshake path set this false to avoid
   * binding a real socket.
   */
  readonly startSocketServer?: boolean;
}

/** Message types the SW sends back on the action/pairing correlation channel. */
const ACTION_REPLY_TYPES = new Set(['action.result', 'action.confirm.shown', 'pair.result']);

/** Message-type strings the ingest handler claims. */
const INGEST_TYPES = new Set([
  'session.append',
  'console.append',
  'network.append',
  'shadow.report',
]);

/**
 * Start the native messaging host: open the DB (running migrations) and begin
 * decoding inbound messages from `process.stdin`. Unknown message types get a
 * structured error reply rather than crashing the host.
 */
export function startNativeHost(options: NativeHostOptions = {}): NativeHostHandle {
  const db = options.dbPath !== undefined ? openDb({ path: options.dbPath }) : openDb();
  const home = options.home ?? peekHomeDir();
  const ingestCtx = { db, home };
  const output = options.output;

  const readOptions: { input?: Readable; onError?: (err: Error) => void } = {
    onError: (err) => {
      console.error(`native host: skipped malformed frame — ${err.message}`);
    },
  };
  if (options.input !== undefined) readOptions.input = options.input;

  // IPC relay to the MCP-server process (Task 3.24). The MCP process's
  // LocalSocketHostBridge connects here; the server relays `act.request` →
  // native-port `action.request` (via `write`, the host → SW direction) and
  // `action.result` (inbound, see handleMessage) → `act.response`.
  let socketServer: HostSocketServer | undefined;
  if (options.startSocketServer !== false) {
    // Resolve the socket path: explicit option wins; else derive from the
    // (possibly test-overridden) peek data dir via hostSocketPath(home). This
    // is the SAME function the MCP-process bridge dials, so both sides agree —
    // including under a custom $PEEK_HOME (item D). On Windows it's the fixed
    // named pipe; a test `home` binds its own socket and never collides.
    const socketPath = options.socketPath ?? hostSocketPath(home);
    socketServer = new HostSocketServer({
      // postToSw writes the action.request out the native port (host → SW).
      postToSw: (message) => {
        void write(message).catch((err) => {
          console.error(
            `native host: action.request post failed — ${err instanceof Error ? err.message : String(err)}`,
          );
        });
      },
      // SP4: postPairToSw writes the pair.request out the native port (host → SW).
      // The SW handler (Task 5) discriminates pair.request from action.request.
      postPairToSw: (message) => {
        void write(message).catch((err) => {
          console.error(
            `native host: pair.request post failed — ${err instanceof Error ? err.message : String(err)}`,
          );
        });
      },
      socketPath,
      // Item I/J: bind failures (EADDRINUSE/EACCES) are emitted ASYNC via the
      // server 'error' event, so a try/catch around listen() can't catch them.
      // The server probes live-vs-stale + retries once on a stale socket; if it
      // still can't bind it calls this. Degrade — the action write-path is down,
      // but ingest/capture still flows — never crash the host.
      onListenError: (err) => {
        console.error(`native host: IPC socket failed to listen — ${err.message}`);
        socketServer = undefined;
      },
    });
    // listen() is async-internally (the bind-error/probe/retry path); it never
    // throws synchronously, but keep the try/catch for a defensive construct-time
    // failure.
    try {
      socketServer.listen();
    } catch (err) {
      console.error(
        `native host: IPC socket listen threw — ${err instanceof Error ? err.message : String(err)}`,
      );
      socketServer = undefined;
    }
  }

  const done = readMessages((message) => {
    // A reply-write failure (e.g. the browser closed the port mid-reply) must
    // not become an unhandled rejection that tears down the host.
    handleMessage(message).catch((err) => {
      console.error(
        `native host: failed handling message — ${err instanceof Error ? err.message : String(err)}`,
      );
    });
  }, readOptions);

  return {
    done,
    close() {
      socketServer?.close();
      db.close();
    },
  };

  async function handleMessage(message: unknown): Promise<void> {
    const type =
      message && typeof message === 'object' && 'type' in message
        ? String((message as { type: unknown }).type)
        : undefined;

    if (type === 'host.hello') {
      await write({
        type: 'host.hello.ok',
        schemaVersion: schemaVersion(db),
        ...(options.callerOrigin !== undefined ? { callerOrigin: options.callerOrigin } : {}),
      });
      return;
    }

    // Action-request correlation replies from the SW (Task 3.24). Forward to
    // the IPC relay, which writes the mapped `act.response` back to the
    // originating MCP-process socket connection. These are NOT acked over the
    // native port (the MCP process is the one awaiting, over the socket).
    if (type !== undefined && ACTION_REPLY_TYPES.has(type)) {
      socketServer?.onSwMessage(
        message as ActionResultMessage | ActionConfirmShownMessage | PairResultMessage,
      );
      return;
    }

    if (type !== undefined && INGEST_TYPES.has(type)) {
      // ingest() catches its own throws + returns a structured reply. The
      // try/catch here is defense in depth: if a future regression introduces
      // a throw path, the host loop still survives.
      let reply: unknown;
      try {
        reply = ingest(message as IncomingMessage, ingestCtx);
      } catch (err) {
        reply = {
          type: 'ingest.err',
          code: 'handler_threw',
          detail: err instanceof Error ? err.message : String(err),
        };
      }
      await write(reply);
      return;
    }

    // Real handlers (act-tool action.request → action.result correlation)
    // arrive with the IPC bridge in a later chunk.
    await write({
      type: 'error',
      code: 'unhandled_message',
      detail: `native host: no handler for message type '${type ?? '(none)'}' yet`,
    });
  }

  async function write(value: unknown): Promise<void> {
    if (output !== undefined) await writeMessage(value, output);
    else await writeMessage(value);
  }
}
