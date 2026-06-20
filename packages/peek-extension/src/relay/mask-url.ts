/**
 * URL query-value masking — extracted from `mask.ts` so it can be imported by
 * modules that must NOT pull in `@cubenest/rrweb-core`.
 *
 * Why a separate file: `mask.ts` imports `@cubenest/rrweb-core` (whose `exports`
 * point at a gitignored, build-on-demand `dist/`). When a WXT *entrypoint* (e.g.
 * the background service worker) imports a relative module, `wxt prepare` (run as
 * the extension's postinstall, BEFORE `pnpm build`) transforms that module's whole
 * graph — so a relative import of `mask.ts` forces Vite to resolve rrweb-core's
 * unbuilt entry and the install fails on a cold checkout. `maskUrl` is pure (only
 * `URL`), so it lives here with no rrweb-core dependency; entrypoints import it
 * from this file, and `mask.ts` re-exports it for its existing consumers.
 *
 * Pure: string in, string out. No DOM, no `chrome.*`, no rrweb-core.
 */

/**
 * Redact query-PARAMETER VALUES while keeping the path + which params existed.
 * URLs routinely carry secrets in the query string (`?access_token=sk-live-…`,
 * `?api_key=`, `?token=`, `?session=`). Keeping the keys + path preserves
 * debugging value ("which params were sent") without leaking the secret. Fails
 * closed: if the URL won't parse, drop the query entirely rather than forward it
 * raw.
 *
 * Used by the ISOLATED relay's network masking and by the SW's R2
 * `element_detail` branch (an element's `href`) — one masking definition, not a
 * parallel one that could drift.
 */
export function maskUrl(url: string): string {
  try {
    const u = new URL(url);
    for (const key of [...u.searchParams.keys()]) {
      u.searchParams.set(key, '<<REDACTED>>');
    }
    return u.href;
  } catch {
    // Unparseable (relative URL, malformed) — strip the query to be safe.
    const q = url.indexOf('?');
    return q === -1 ? url : url.slice(0, q);
  }
}
