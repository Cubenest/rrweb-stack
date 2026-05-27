// Native messaging host runner (ADR-0007). Spawned by the browser over stdio
// when invoked as `peek-mcp --native-host`. It owns ~/.peek/sessions.db and
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

/**
 * Start the native messaging host: open the DB (running migrations) and begin
 * decoding inbound messages from `process.stdin`. Unknown message types get a
 * structured error reply rather than crashing the host.
 */
export function startNativeHost(): NativeHostHandle {
  const db = openDb();

  const done = readMessages((message) => {
    void handleMessage(message);
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
