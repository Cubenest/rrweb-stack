// CDP network capture wiring (Task 2.16 / P1 PRD §E.2).
//
// Enable the CDP Network domain, subscribe to `Network.responseReceived`, and
// route any response with `status >= 400` into the page's `console.error` via
// `executor.execute`. The rrweb console plugin (installed by @tracelane/core's
// recorder) then captures that console line, so failed responses show up in the
// report's console panel "for free" — no dedicated network transport in v1.
//
// The console line is prefixed `[tracelane.net]` so @tracelane/report's network
// panel can scrape it back out (NETWORK_CONSOLE_PREFIX in panels.ts).

import type { BrowserExecutor } from '@tracelane/core';

/** The fields of a CDP `Network.responseReceived` event we read (P1 PRD §E.1). */
interface ResponseReceivedEvent {
  response?: {
    url?: string;
    status?: number;
    requestHeaders?: Record<string, string>;
  };
}

/**
 * Page-side logger. Self-contained (no Node closures) so it can be
 * `.toString()`-serialized by `execute` (PRD §A.4). The console plugin captures
 * this `console.error`; the `[tracelane.net]` prefix lets the report's network
 * panel scrape it back out (PRD §E.2).
 */
function logNetworkErrorInPage(url: string, status: number, method: string): void {
  console.error(`[tracelane.net] ${method} ${status} ${url}`);
}

/** Pull the request method out of CDP request headers, defaulting to GET. */
function methodOf(headers: Record<string, string> | undefined): string {
  if (!headers) return 'GET';
  // CDP exposes the pseudo-header `:method` for HTTP/2/3; fall back to a plain
  // `method` header, then GET.
  return headers[':method'] ?? headers.method ?? 'GET';
}

/**
 * Attach CDP network capture to a BrowserExecutor (P1 PRD §E.2).
 *
 * Enables the Network domain and registers a `Network.responseReceived`
 * subscriber that forwards 4xx/5xx responses into `console.error`. Resolves once
 * `Network.enable` has been sent. The subscriber's own `execute` calls are
 * fire-and-forget (their failures must not break the test).
 */
export async function attachNetworkCapture(executor: BrowserExecutor): Promise<void> {
  await executor.cdp('Network', 'enable');
  executor.on('Network.responseReceived', (params: unknown) => {
    const response = (params as ResponseReceivedEvent)?.response;
    const status = response?.status;
    if (typeof status !== 'number' || status < 400) return;
    const url = response?.url ?? '';
    const method = methodOf(response?.requestHeaders);
    // Fire-and-forget: a logging failure (e.g. page mid-navigation) must not
    // surface as a test error.
    void executor
      .execute(logNetworkErrorInPage as (...args: unknown[]) => void, url, status, method)
      .catch(() => {
        /* page may be navigating; drop this one line */
      });
  });
}

// Exposed for unit tests: the page-side logger + method resolver are pure.
export const __internal = { logNetworkErrorInPage, methodOf };
