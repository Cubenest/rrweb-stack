// Chrome / Edge native-messaging transport (ADR-0007 action item 4).
//
// Framing: a 4-byte little-endian uint32 length header followed by that many
// bytes of UTF-8 JSON. Size caps come straight from the Microsoft Edge
// native-messaging docs (echoed for Chrome): a single message *from* the host
// to the extension may be at most 1 MB; a message *to* the host may be up to
// 4 GB. We enforce the 1 MB cap on write (host -> ext) and the 4 GB cap on
// read (ext -> host) so a misbehaving peer can't make us buffer unbounded.

import type { Readable, Writable } from 'node:stream';

/** Max bytes for a host -> extension message (1 MB), per Chrome/Edge spec. */
export const MAX_HOST_TO_EXT_BYTES = 1024 * 1024;

/** Max bytes for an extension -> host message (4 GB), per Chrome/Edge spec. */
export const MAX_EXT_TO_HOST_BYTES = 4 * 1024 * 1024 * 1024;

/** Width of the little-endian length prefix. */
export const LENGTH_PREFIX_BYTES = 4;

/**
 * Encode a value into a framed native-messaging buffer: a 4-byte little-endian
 * length header followed by the UTF-8 JSON body.
 *
 * Throws if the encoded body exceeds the host -> extension 1 MB cap.
 */
export function encodeMessage(value: unknown): Buffer {
  const body = Buffer.from(JSON.stringify(value), 'utf8');
  if (body.length > MAX_HOST_TO_EXT_BYTES) {
    throw new Error(
      `native-messaging: message of ${body.length} bytes exceeds the ${MAX_HOST_TO_EXT_BYTES}-byte host->ext cap`,
    );
  }
  const header = Buffer.allocUnsafe(LENGTH_PREFIX_BYTES);
  header.writeUInt32LE(body.length, 0);
  return Buffer.concat([header, body]);
}

/**
 * Write a single framed message to a stream (default `process.stdout`). The
 * promise resolves once the bytes are flushed to the underlying handle.
 */
export function writeMessage(value: unknown, out: Writable = process.stdout): Promise<void> {
  const framed = encodeMessage(value);
  return new Promise((resolve, reject) => {
    out.write(framed, (err) => (err ? reject(err) : resolve()));
  });
}

/**
 * Streaming decoder for the inbound (extension -> host) direction. Feed it raw
 * chunks as they arrive; it emits each fully-framed JSON message via the
 * `onMessage` callback. Enforces the 4 GB ext -> host cap on the declared
 * length before buffering the body.
 */
export interface MessageDecoderOptions {
  /** Max declared frame length before the ext -> host cap guard throws. */
  readonly maxBytes?: number;
  /** Invoked when a frame body fails to JSON-parse; the frame is then skipped. */
  readonly onError?: (error: Error) => void;
}

export class MessageDecoder {
  #buffer: Buffer = Buffer.alloc(0);
  #expectedLength: number | null = null;
  readonly #onMessage: (message: unknown) => void;
  readonly #maxBytes: number;
  readonly #onError: ((error: Error) => void) | undefined;

  constructor(onMessage: (message: unknown) => void, options: MessageDecoderOptions = {}) {
    this.#onMessage = onMessage;
    this.#maxBytes = options.maxBytes ?? MAX_EXT_TO_HOST_BYTES;
    this.#onError = options.onError;
  }

  /** Append a chunk and drain any complete messages it now contains. */
  push(chunk: Buffer): void {
    this.#buffer = this.#buffer.length === 0 ? chunk : Buffer.concat([this.#buffer, chunk]);

    // Loop because one chunk may complete multiple queued messages.
    for (;;) {
      if (this.#expectedLength === null) {
        if (this.#buffer.length < LENGTH_PREFIX_BYTES) return;
        const len = this.#buffer.readUInt32LE(0);
        if (len > this.#maxBytes) {
          throw new Error(
            `native-messaging: declared length ${len} exceeds the ${this.#maxBytes}-byte ext->host cap`,
          );
        }
        this.#expectedLength = len;
        this.#buffer = this.#buffer.subarray(LENGTH_PREFIX_BYTES);
      }

      if (this.#buffer.length < this.#expectedLength) return;

      const body = this.#buffer.subarray(0, this.#expectedLength);
      this.#buffer = this.#buffer.subarray(this.#expectedLength);
      this.#expectedLength = null;

      // A single malformed frame must not kill the host loop: skip it (the
      // frame was already consumed above, so the stream stays correctly aligned
      // for the next length-prefixed message) and report it via onError.
      let parsed: unknown;
      try {
        parsed = JSON.parse(body.toString('utf8'));
      } catch (err) {
        this.#onError?.(err instanceof Error ? err : new Error(String(err)));
        continue;
      }
      this.#onMessage(parsed);
    }
  }

  /** Number of bytes currently buffered awaiting a complete frame. */
  get pending(): number {
    return this.#buffer.length;
  }
}

export interface ReadMessagesOptions {
  /** Stream to read from (default `process.stdin`). */
  readonly input?: Readable;
  /** Invoked when a malformed frame is skipped (does not reject the promise). */
  readonly onError?: (error: Error) => void;
}

/**
 * Read framed messages from a stream (default `process.stdin`), invoking
 * `onMessage` for each. Resolves when the stream ends; rejects on a stream
 * error or a frame that violates the size cap. A frame whose body fails to
 * JSON-parse is skipped (reported via `onError`) rather than terminating the
 * stream — a single malformed message from the extension must not kill the host.
 */
export function readMessages(
  onMessage: (message: unknown) => void,
  options: ReadMessagesOptions = {},
): Promise<void> {
  const input = options.input ?? process.stdin;
  const decoder = new MessageDecoder(
    onMessage,
    options.onError !== undefined ? { onError: options.onError } : {},
  );
  return new Promise((resolve, reject) => {
    input.on('data', (chunk: Buffer) => {
      try {
        decoder.push(chunk);
      } catch (err) {
        reject(err);
      }
    });
    input.on('end', resolve);
    input.on('error', reject);
  });
}
