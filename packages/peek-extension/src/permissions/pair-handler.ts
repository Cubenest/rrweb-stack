/**
 * Pure helpers for the SP4 connector-pairing prompt + secret-mint flow (Task 5).
 *
 * Extracted from background.ts so the logic is unit-testable without a real
 * browser or the `defineBackground` closure. Background.ts calls these from
 * inside `handlePairRequest`, which holds the `pendingPairings` map and the
 * `chrome.*` side-effects.
 *
 * Security invariants (locked by design):
 *   - The plaintext secret is returned exactly once (in the pair.result).
 *   - Only the SHA-256 hash is stored in `chrome.storage.local`.
 *   - The plaintext secret is never logged.
 *   - Mint uses `crypto.getRandomValues` (32 bytes → base64url).
 *
 * connectorId derivation:
 *   Lowercase the clientName, collapse runs of non-alphanumeric characters
 *   to a single hyphen, strip leading/trailing hyphens. Collisions (same
 *   derivation → same id) mean the latest pairing overwrites the previous one.
 *   Examples: "Cursor MCP" → "cursor-mcp", "Claude Code!" → "claude-code".
 *   A fully-symbolic name that collapses to "" falls back to "connector".
 */

import type { ShowPairMessage } from '../messaging/protocol';
import type { PairVerdictMessage } from '../messaging/protocol';
import type { StorageAreaLike } from './pairing-store';
import { putPairedConnector, sha256Hex } from './pairing-store';

/** The result of a pair-request round-trip. Mirrors PairResultMessage fields. */
export interface PairResult {
  approved: boolean;
  secret?: string;
  error?: string;
}

/**
 * Derive a stable connector storage id from a human-readable client name.
 *
 * Lowercases, collapses runs of non-alphanumeric characters to a single
 * hyphen, strips leading/trailing hyphens. Falls back to "connector" when
 * the result is empty (fully-symbolic input).
 */
export function connectorIdFromClientName(clientName: string): string {
  const id = clientName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return id.length > 0 ? id : 'connector';
}

/**
 * Mint a high-entropy pairing secret: 32 random bytes encoded as base64url
 * (no padding). URL-safe alphabet (A–Z, a–z, 0–9, -, _).
 *
 * Called from the SW (runtime code); `crypto.getRandomValues` is available in
 * both the MV3 service worker and Node.js test environments (Node 19+).
 */
export function mintPairingSecret(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  // base64url encode: convert to binary string, then btoa, replace +/= chars.
  const binary = Array.from(bytes, (b) => String.fromCharCode(b)).join('');
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Default pairing timeout: 2 minutes, matching CONFIRM_TIMEOUT_MS. */
export const PAIR_TIMEOUT_MS = 2 * 60_000;

/**
 * Pure implementation of the pairing round-trip, extracted for testability.
 *
 * The caller (`handlePairRequest` in background.ts) supplies:
 *   - `request`: the ShowPairMessage to process.
 *   - `area`: the storage area to write the hash to (defaults to
 *     `chrome.storage.local` in production).
 *   - `onShowPair`: called once when the "prompt" is ready — in tests this
 *     is a function that resolves the verdict synchronously; in background.ts
 *     this posts the ShowPairMessage and registers the pending entry.
 *   - `timeoutMs`: how long to wait before fail-closing (default 2 min).
 *
 * The function returns a PairResult. On `approved:true`, the result carries
 * the plaintext `secret` exactly once; the hash is written to storage. On
 * `approved:false` or timeout, the result is `{approved:false}` with nothing
 * stored.
 */
export async function runHandlePairRequest(
  request: ShowPairMessage,
  area: StorageAreaLike,
  onShowPair: (resolveVerdict: (verdict: PairVerdictMessage) => void) => void,
  timeoutMs: number = PAIR_TIMEOUT_MS,
): Promise<PairResult> {
  const verdict = await new Promise<PairVerdictMessage>((resolve) => {
    const timer = setTimeout(() => {
      resolve({
        type: 'pairVerdict',
        requestId: request.requestId,
        approved: false,
      });
    }, timeoutMs);

    // Register the resolve callback first so a fast verdict can't race ahead.
    const resolveVerdict = (v: PairVerdictMessage): void => {
      clearTimeout(timer);
      resolve(v);
    };

    onShowPair(resolveVerdict);
  });

  if (!verdict.approved) {
    // Deny or timeout — store nothing, return no secret.
    return { approved: false };
  }

  // Approved: mint secret, hash it, store only the hash.
  const secret = mintPairingSecret();
  const hash = await sha256Hex(secret);
  const connectorId = connectorIdFromClientName(request.clientName);

  await putPairedConnector(
    connectorId,
    { clientName: request.clientName, hash, pairedAtMs: Date.now() },
    area,
  );

  // Return the plaintext exactly once. Never log it.
  return { approved: true, secret };
}
