/**
 * Origin / match-pattern derivation for per-site activation (ADR-0008, P2 PRD
 * §D.1). Pure functions — no `chrome.*` — so they unit-test cleanly.
 *
 * Two grant scopes are offered per site (§D.1):
 *   - "Just this tab"        → use the `activeTab` permission, no host grant.
 *   - "All tabs on this domain" → request `https://example.com/*` via
 *     `chrome.permissions.request({ origins })` and persist the origin.
 *
 * Chrome host-permission match patterns are `<scheme>://<host>/<path>`. For a
 * per-origin grant we want `<scheme>://<host>/*`.
 */

/** The two activation scopes surfaced in the side-panel CTA (§D.1). */
export type ActivationScope = 'tab' | 'origin';

/**
 * Derive the bare origin (`https://example.com`) from a full tab URL.
 *
 * @returns the origin, or `null` for URLs that can never be recorded
 *   (chrome://, chrome-extension://, about:, file:, data:, or unparseable).
 */
export function originFromUrl(url: string | undefined | null): string | null {
  if (!url) return null;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  // Only http(s) origins are activatable. Browser-internal and local-file
  // schemes are out of scope (host permissions can't be granted for them and
  // recording them is not a goal).
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    return null;
  }
  return parsed.origin;
}

/**
 * Build the Chrome host match pattern for an "all tabs on this domain" grant.
 * `chrome.permissions.request` wants patterns like `https://example.com/*`.
 *
 * @param origin a bare origin such as `https://example.com`
 * @returns the `origin + '/*'` match pattern, or `null` if the origin is
 *   not a valid http(s) origin.
 */
export function originMatchPattern(origin: string | undefined | null): string | null {
  const normalized = originFromUrl(origin);
  if (!normalized) return null;
  return `${normalized}/*`;
}

/**
 * Resolve a tab URL + chosen scope into the concrete permission request.
 *
 * For `scope === 'origin'` we return the match pattern to hand to
 * `chrome.permissions.request({ origins })`. For `scope === 'tab'` there is no
 * host grant to request (activeTab covers the current tab), so `origins` is
 * empty — the caller relies on the `activeTab` permission instead.
 *
 * @returns `{ origin, origins }` where `origins` is the array to pass to
 *   `chrome.permissions.request`, or `null` if the URL is not activatable.
 */
export function deriveActivationRequest(
  url: string | undefined | null,
  scope: ActivationScope,
): { origin: string; origins: string[] } | null {
  const origin = originFromUrl(url);
  if (!origin) return null;
  if (scope === 'tab') {
    return { origin, origins: [] };
  }
  const pattern = originMatchPattern(origin);
  // originMatchPattern can only be null when origin is null, already handled.
  return { origin, origins: pattern ? [pattern] : [] };
}

/**
 * Whether a candidate URL is covered by an already-granted origin.
 *
 * Note (ADR-0008 "Harder"): a grant on `https://example.com` does NOT cover
 * `https://app.example.com` — subdomains are distinct origins. Callers use
 * this to decide whether to surface the "extend to this subdomain?" prompt.
 */
export function isUrlCoveredByOrigin(
  url: string | undefined | null,
  grantedOrigin: string,
): boolean {
  const origin = originFromUrl(url);
  return origin !== null && origin === grantedOrigin;
}
