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
import { type IncomingMessage, ingest } from './ingest.js';
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
}

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
