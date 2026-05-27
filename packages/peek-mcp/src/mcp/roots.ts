// MCP Roots scoping (Task 3.14 / P2 PRD §B5). On `oninitialized` the server
// asks whether the client advertised the `roots` capability; if so it fetches
// the client's roots (project directories) and derives the origins peek should
// scope session queries to. Two defensive realities drive the design:
//
//   1. Anthropic claude-code Issue #3315 (Apr 2026): Claude Code advertises the
//      `roots` capability but historically did NOT implement `roots/list` — a
//      naive `await listRoots()` hangs forever. So we race it against a 1s
//      timeout and fall back to "all sessions" (no scoping).
//   2. modelcontextprotocol/servers Issue #3602: the filesystem server
//      *replaces* its allowed dirs with the client roots. peek instead treats
//      roots as a SOFT filter over origins (v1) — see deriveAllowedOrigins.
//
// This module is transport-agnostic and side-effect-free: it takes the two
// Server methods it needs as inputs so it's trivially unit-testable.

/**
 * The subset of `McpServer.server` this module depends on. Kept structurally
 * loose (only the fields we read) so the SDK's richer `listRoots` return type
 * (extra `_meta`, index signature) assigns cleanly under exactOptionalPropertyTypes.
 */
export interface RootsCapableServer {
  getClientCapabilities(): { roots?: unknown } | undefined;
  listRoots(): Promise<{ roots: ReadonlyArray<{ uri: string }> }>;
}

/** Resolved scope after consulting (or failing to consult) the client's roots. */
export interface RootsScope {
  /**
   * Origins (`scheme://host[:port]`) the session queries should be limited to,
   * or `undefined` to mean "no scoping — all sessions" (the safe fallback when
   * the client doesn't support roots, doesn't answer, or supplies roots from
   * which no origin can be derived).
   */
  readonly allowedOrigins: string[] | undefined;
  /** Why we ended up with this scope — surfaced in logs / tests. */
  readonly reason:
    | 'no-roots-capability'
    | 'roots-timeout'
    | 'roots-error'
    | 'no-origins-derived'
    | 'scoped';
}

/** The unscoped fallback. */
const UNSCOPED = (reason: RootsScope['reason']): RootsScope => ({
  allowedOrigins: undefined,
  reason,
});

/**
 * Race a promise against a timeout. Resolves to the promise's value, or
 * `{ timedOut: true }` after `ms`. The losing promise is left to settle
 * (its result is ignored) — we never reject from the timeout path.
 */
async function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
): Promise<{ timedOut: false; value: T } | { timedOut: true }> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<{ timedOut: true }>((resolve) => {
    timer = setTimeout(() => resolve({ timedOut: true }), ms);
    // Don't keep the event loop alive solely for this timer.
    timer.unref?.();
  });
  try {
    const value = await Promise.race([
      promise.then((v) => ({ timedOut: false as const, value: v })),
      timeout,
    ]);
    return value;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Derive the origins peek should scope to from a set of client roots. Roots are
 * usually `file://` project directories (e.g. `file:///Users/x/repo`), not web
 * origins — so v1 derives origins only from roots that ARE http(s) URIs (a
 * client that surfaces a dev-server URL as a root). `file://` roots yield no
 * origin here (deriving localhost ports from package.json/vite config is a
 * documented future enhancement, PRD §B5), so a file-only root set falls back
 * to unscoped rather than scoping to nothing.
 */
export function deriveAllowedOrigins(roots: ReadonlyArray<{ uri: string }>): string[] {
  const origins = new Set<string>();
  for (const root of roots) {
    try {
      const url = new URL(root.uri);
      if (url.protocol === 'http:' || url.protocol === 'https:') {
        origins.add(url.origin);
      }
    } catch {
      // Non-URL root — skip.
    }
  }
  return [...origins];
}

export interface ResolveRootsScopeOptions {
  /** Timeout for `roots/list` before falling back (default 1000ms, Issue #3315). */
  readonly timeoutMs?: number;
}

/**
 * Consult the client's roots (if advertised) and resolve the session scope,
 * defensively timing out per claude-code Issue #3315. Never throws — every
 * failure mode degrades to {@link UNSCOPED}.
 */
export async function resolveRootsScope(
  server: RootsCapableServer,
  options: ResolveRootsScopeOptions = {},
): Promise<RootsScope> {
  const timeoutMs = options.timeoutMs ?? 1000;
  const caps = server.getClientCapabilities();
  if (!caps?.roots) {
    return UNSCOPED('no-roots-capability');
  }

  const raced = await withTimeout(server.listRoots(), timeoutMs).catch(() => ({
    timedOut: false as const,
    value: undefined,
  }));

  if (raced.timedOut) {
    return UNSCOPED('roots-timeout');
  }
  const result = raced.value;
  if (!result || !Array.isArray(result.roots)) {
    return UNSCOPED('roots-error');
  }

  const allowedOrigins = deriveAllowedOrigins(result.roots);
  if (allowedOrigins.length === 0) {
    return UNSCOPED('no-origins-derived');
  }
  return { allowedOrigins, reason: 'scoped' };
}
