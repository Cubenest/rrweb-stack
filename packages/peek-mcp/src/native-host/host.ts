// Native messaging host runner (ADR-0007). Spawned by the browser over stdio
// (via the manifest's `path`, with the calling extension's origin as an
// argument) or manually with `--native-host`. It owns ~/.peek/sessions.db and
// reads length-prefixed JSON messages from the extension.
//
// Phase 3a wires the transport + DB open and a minimal handshake so the channel
// is verifiable end-to-end; the full message handlers (session.append,
// console/network ingest, act-tool dispatch) land with the extension in
// Phase 3d.

import { openDb, schemaVersion } from '../db/open.js';
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
}

/**
 * Start the native messaging host: open the DB (running migrations) and begin
 * decoding inbound messages from `process.stdin`. Unknown message types get a
 * structured error reply rather than crashing the host.
 */
export function startNativeHost(options: NativeHostOptions = {}): NativeHostHandle {
  const db = openDb();

  const done = readMessages((message) => {
    // A reply-write failure (e.g. the browser closed the port mid-reply) must
    // not become an unhandled rejection that tears down the host.
    handleMessage(message).catch((err) => {
      console.error(
        `native host: failed handling message — ${err instanceof Error ? err.message : String(err)}`,
      );
    });
  });

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
      await writeMessage({
        type: 'host.hello.ok',
        schemaVersion: schemaVersion(db),
        ...(options.callerOrigin !== undefined ? { callerOrigin: options.callerOrigin } : {}),
      });
      return;
    }

    // Real handlers (session.append, console/network ingest, act-tools) arrive
    // with the extension in Phase 3d.
    await writeMessage({
      type: 'error',
      code: 'unhandled_message',
      detail: `native host: no handler for message type '${type ?? '(none)'}' yet (Phase 3d)`,
    });
  }
}
