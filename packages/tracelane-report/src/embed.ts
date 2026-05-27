// Events blob embedding (Task 2.9).
//
// The pipeline:   events --JSON--> gzip (@cubenest/rrweb-core.compress)
//                        --base64--> EVENTS_GZ_B64 string in the report.
//
// At view time the inlined fflate gunzips the decoded bytes and JSON.parses
// them — so the report decompresses fully offline (Task 2.9). The wire format
// is deliberately interoperable with the substrate's compress/decompress pair:
// base64(compress(events)) on the way in, decompress(base64-decode) on the way
// out. `decodeEventsBlob` here mirrors what the in-page bootstrap does, and the
// round-trip is asserted in tests.

import { compress, decompress } from '@cubenest/rrweb-core';
import type { eventWithTime } from '@cubenest/rrweb-core';

// Base64 in 8 KB chunks: `btoa(String.fromCharCode(...all))` overflows the call
// stack on multi-MB reports (events can approach the 25 MB cap). `btoa` is a
// web standard available in both Node (16+) and the browser/jsdom.
const CHUNK = 0x8000;

/** base64-encode raw bytes without a Buffer dependency or a stack-blowing spread. */
function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += CHUNK) {
    const slice = bytes.subarray(i, i + CHUNK);
    binary += String.fromCharCode(...slice);
  }
  return btoa(binary);
}

/** Inverse of {@link bytesToBase64}. */
function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

/**
 * Encode an rrweb event array to the base64-of-gzip string embedded in the
 * report as `EVENTS_GZ_B64`. The string uses only the standard base64 alphabet,
 * so it is safe inside a double-quoted JS string literal in the HTML.
 */
export function encodeEventsBlob(events: eventWithTime[]): string {
  return bytesToBase64(compress(events));
}

/**
 * Decode the embedded blob back to the event array. Node-side mirror of the
 * in-page decompress path; used for the build→embed→decode round-trip test and
 * available to consumers that want to re-read a report's events.
 */
export function decodeEventsBlob(b64: string): eventWithTime[] {
  return decompress(base64ToBytes(b64));
}
