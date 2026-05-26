// Compression helpers — Task 1.9.
//
// Two thin functions, backed by fflate's synchronous gzip APIs. Per ADR-0002
// + PostHog's own guidance, the shared core does NOT register a packFn for
// per-event compression — per-event compression is inefficient compared to
// per-batch. These helpers always operate on an entire event array at once.
//
// Use cases:
//   • Embedding a session into a self-contained HTML report (base64 the
//     gzipped bytes, drop into a <script> tag).
//   • Persisting batched chunks to IndexedDB before upload.
//   • Sending batched payloads to a backend.
//
// Intentional non-features (YAGNI per ADR-0002):
//   • No streaming / async APIs — synchronous gzip is fine for batch sizes
//     we care about (under ~25 MB by report-size guard).
//   • No options block — level=6 is fflate's default and a sane sweet spot
//     between speed and ratio for repetitive rrweb payloads.
//   • No custom dictionaries.

import { gunzipSync, gzipSync, strFromU8, strToU8 } from 'fflate';
import type { eventWithTime } from '../rrweb';

/**
 * Per-batch gzip compression of an rrweb event array.
 *
 * Always operates on the entire array — never per-event.
 *
 * @param events  the rrweb event array to compress
 * @returns gzipped bytes; suitable for base64-embedding in a self-contained
 *          HTML report or persisting to IndexedDB
 * @throws {TypeError} if `events` is not an array
 */
export function compress(events: eventWithTime[]): Uint8Array {
  if (!Array.isArray(events)) {
    throw new TypeError('compress: events must be an array');
  }
  const json = JSON.stringify(events);
  const bytes = strToU8(json);
  return gzipSync(bytes, { level: 6 });
}

/**
 * Inverse of `compress`. Decompresses gzipped bytes back into the original
 * event array.
 *
 * @param bytes  gzipped output from `compress`
 * @returns the original event array
 * @throws {TypeError} if `bytes` is not a Uint8Array, if the gzip frame is
 *                    malformed (fflate's own error), or if the inflated
 *                    payload does not deserialize to a JSON array
 */
export function decompress(bytes: Uint8Array): eventWithTime[] {
  if (!(bytes instanceof Uint8Array)) {
    throw new TypeError('decompress: bytes must be a Uint8Array');
  }
  const decompressed = gunzipSync(bytes);
  const json = strFromU8(decompressed);
  const parsed = JSON.parse(json);
  if (!Array.isArray(parsed)) {
    throw new TypeError('decompress: payload did not deserialize to an array');
  }
  return parsed as eventWithTime[];
}
