// Platform-native base64 decoder — Task 1.6.
//
// The substrate must stay environment-agnostic. `Buffer.from(str, 'base64')`
// would tie us to Node; pulling in a JS-side decoder bloats the bundle. Both
// targets (Node 20.10+ and modern browsers) ship `atob` on globalThis, so
// we use it.
//
// `atob` returns a binary string — each char's `.charCodeAt(0)` is the
// corresponding byte. We materialise that into a Uint8Array with
// `Uint8Array.from`, which is O(n) and allocates exactly once.

/**
 * Decode a base64 string to bytes using the platform-native `atob`.
 *
 * @throws DOMException ("InvalidCharacterError") if the input is not
 *         well-formed base64 — caller decides whether to wrap.
 */
export function decodeBase64(base64: string): Uint8Array {
  const bin = atob(base64);
  return Uint8Array.from(bin, (ch) => ch.charCodeAt(0));
}
