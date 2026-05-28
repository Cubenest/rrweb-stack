// Chrome extension ID validator + helpers used by `peek init` (P-10 fix,
// 2026-05-28 QA walk).
//
// Chrome derives the unpacked-extension ID from the SHA-256 of the absolute
// path of the extension folder, mapped through a 16-letter alphabet (a–p).
// That makes every loaded-unpacked extension ID a 32-character string of
// lowercase a–p — and the same shape Chrome uses for Web Store IDs. peek init
// captures this ID and writes it into the native-host manifest's
// `allowed_origins` so Chrome will let the unpacked extension connect to the
// native host (without an entry the manifest ships with `allowed_origins: []`
// and Chrome silently blocks `chrome.runtime.connectNative()`).
//
// Pure helpers — no prompt I/O lives here. The prompt loop in
// commands/init.ts calls `validateChromeExtensionId` from prompt.ts's
// `promptText({ validate })` so tests cover the input shape independently of
// the readline machinery.

/** Length + alphabet Chrome uses for both unpacked and Web Store extension IDs. */
const EXTENSION_ID_LENGTH = 32;
const EXTENSION_ID_PATTERN = /^[a-p]{32}$/;

/**
 * Validate a candidate Chrome extension ID. Returns `null` if the input is the
 * expected 32-character `a–p` shape; otherwise a user-facing error message.
 *
 * Trims internal whitespace defensively — users routinely paste from
 * `chrome://extensions/` with a trailing newline or leading space.
 */
export function validateChromeExtensionId(raw: string): string | null {
  const id = raw.trim();
  if (id.length === 0) {
    return 'Extension ID is required (or leave empty to skip).';
  }
  if (id.length !== EXTENSION_ID_LENGTH) {
    return `Expected a 32-character ID; got ${id.length}. (Copy it from chrome://extensions/.)`;
  }
  if (!EXTENSION_ID_PATTERN.test(id)) {
    return 'Extension IDs are 32 lowercase letters a–p only. Re-copy from chrome://extensions/.';
  }
  return null;
}

/**
 * Build the `chrome-extension://<id>/` origin Chrome expects in a native-host
 * manifest's `allowed_origins`. Mirrors `allowedOrigins()` in peek-mcp's
 * manifest.ts but emits the bare origin string for a single id (the manifest
 * builder de-dupes when it folds multiple IDs together).
 */
export function chromeExtensionOrigin(id: string): string {
  return `chrome-extension://${id}/`;
}

/**
 * P-13 (2026-05-28 QA walk) — pull the previously-saved unpacked extension ID
 * out of an existing native-host manifest's `allowed_origins`. Returns the
 * first 32-char a–p ID found (origins are written in the order
 * chromeWebStore / edgeAddons / dev, but the published-store slots ship as
 * `PLACEHOLDER_*` strings that `allowedOrigins()` drops, so anything actually
 * present is by definition the user's dev ID).
 *
 * Pure — accepts any value, returns `undefined` for non-objects, malformed
 * arrays, missing fields, or origin strings that don't match the expected
 * `chrome-extension://<a-p×32>/` shape. The caller's idempotency check then
 * skips the prompt and reuses the captured ID.
 */
export function extractDevId(manifest: unknown): string | undefined {
  if (manifest === null || typeof manifest !== 'object') return undefined;
  const ao = (manifest as { allowed_origins?: unknown }).allowed_origins;
  if (!Array.isArray(ao)) return undefined;
  const pattern = /^chrome-extension:\/\/([a-p]{32})\/$/;
  for (const origin of ao) {
    if (typeof origin !== 'string') continue;
    const m = pattern.exec(origin);
    if (m) return m[1];
  }
  return undefined;
}
