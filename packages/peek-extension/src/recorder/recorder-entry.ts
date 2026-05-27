/**
 * MAIN-world recorder entry — the source esbuild bundles into the IIFE
 * `rrweb-recorder.js` that the SW injects with
 * `chrome.scripting.executeScript({ world: 'MAIN', injectImmediately: true })`
 * (Task 3.19, P2 PRD §A.2 + §A.10).
 *
 * WHY A SEPARATE esbuild IIFE (not a WXT/Vite entrypoint): MAIN-world scripts
 * run as CLASSIC scripts. Vite (and therefore WXT/CRXJS) emit ES modules and
 * lean on dynamic `import()` + `chrome.runtime.getURL` to load content scripts
 * — neither works in `world: 'MAIN'` (crxjs discussion #643, quoted in §A.2).
 * So this file is compiled by esbuild with `format: 'iife'`, every transitive
 * dependency of `@cubenest/rrweb-core` inlined, into a single self-contained
 * classic script with no `import`/`export`. The WXT `build:done` hook
 * (wxt.config.ts) runs that esbuild step and drops the result in the output
 * dir. The build is asserted IIFE by scripts/assert-recorder-iife.mjs.
 *
 * THREAT MODEL (§H1): this recorder only ever emits via `window.postMessage`
 * from inside this IIFE closure. It installs NO global handle (no
 * `window.peek = …`) the page could grab to read buffered data or re-drive the
 * recorder. The page shares this realm and can observe the patched
 * `fetch`/`XHR`, but cannot reach the recorder's state. Masking happens on the
 * ISOLATED side before anything is persisted.
 */

import { getRecordConsolePlugin, record } from '@cubenest/rrweb-core';
import { PEEK_NET_SOURCE, PEEK_RRWEB_SOURCE } from './messages.js';
import {
  buildFetchRequest,
  buildFetchResponse,
  buildNetError,
  capBody,
  headersToObject,
} from './net-capture.js';

// Re-`window.eval`'d / re-injected on every navigation; keep it idempotent so a
// double-inject (e.g. a racing executeScript) never double-patches fetch or
// starts two recorders in one realm.
const GUARD = '__peekRecorderInstalled';

declare global {
  interface Window {
    [GUARD]?: boolean;
  }
}

(function installPeekRecorder(): void {
  const w = window as Window & { [GUARD]?: boolean };
  if (w[GUARD]) return;
  w[GUARD] = true;

  // The ONLY escape hatch from this closure. A private function, never exposed
  // on `window` — the page cannot intercept buffered events through a global.
  const postRrweb = (payload: unknown): void => {
    try {
      window.postMessage({ source: PEEK_RRWEB_SOURCE, payload }, '*');
    } catch {
      // postMessage can throw on structured-clone failures; drop the event
      // rather than break the page.
    }
  };
  const postNet = (payload: unknown): void => {
    try {
      window.postMessage({ source: PEEK_NET_SOURCE, payload }, '*');
    } catch {
      /* ignore */
    }
  };

  const uuid = (): string => {
    try {
      if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
        return crypto.randomUUID();
      }
    } catch {
      /* fall through */
    }
    return `peek-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  };

  const now = (): number => Date.now();

  // --- rrweb DOM + console recording -------------------------------------
  // record() returns a stop fn; we deliberately keep no handle (the page could
  // not reach it anyway from inside this closure) — the recorder stops when the
  // page unloads. `emit` posts each event to the ISOLATED relay.
  try {
    record({
      emit: (event: unknown) => postRrweb(event),
      // Open-shadow-root recording is handled by the rrweb fork; closed roots
      // are picked up best-effort by the ISOLATED relay (Task 3.21).
      recordCanvas: false,
      collectFonts: false,
      // Capture console as rrweb plugin events so the relay/native host can
      // extract console_events without a second channel.
      plugins: [getRecordConsolePlugin()],
    } as Parameters<typeof record>[0]);
  } catch (err) {
    postRrweb({ __peekError: 'record_init_failed', detail: String(err) });
  }

  // --- fetch wrap (§A.10) -------------------------------------------------
  const origFetch = window.fetch;
  if (typeof origFetch === 'function') {
    window.fetch = function patchedFetch(
      this: typeof window,
      input: RequestInfo | URL,
      init?: RequestInit,
    ): Promise<Response> {
      const id = uuid();
      try {
        postNet(buildFetchRequest(id, input, init, now()));
      } catch {
        /* never let instrumentation break the request */
      }
      const p = origFetch.call(this, input as RequestInfo, init);
      p.then(
        (resp) => {
          try {
            const clone = resp.clone();
            const headers = headersToObject(clone.headers);
            clone
              .text()
              .then((text) => postNet(buildFetchResponse(id, resp.status, headers, text, now())))
              .catch(() => {
                /* body already consumed elsewhere — skip */
              });
          } catch {
            /* clone can throw on opaque responses — skip body */
          }
        },
        (err) => postNet(buildNetError(id, err, now())),
      );
      return p;
    } as typeof window.fetch;
  }

  // --- XHR wrap (§A.10) ---------------------------------------------------
  interface PeekXhr extends XMLHttpRequest {
    __peek?: { id: string; method: string; url: string; headers: Record<string, string> };
  }
  const X = XMLHttpRequest.prototype;
  const origOpen = X.open;
  const origSend = X.send;
  const origSetHeader = X.setRequestHeader;

  // Forward via rest params (`...rest`) rather than `arguments` — the original
  // signatures carry optional trailing args (open: async/user/password) we must
  // pass through verbatim. The originals return void, so we don't `return`.
  X.open = function peekOpen(
    this: PeekXhr,
    method: string,
    url: string | URL,
    ...rest: unknown[]
  ): void {
    this.__peek = {
      id: uuid(),
      method: (method || 'GET').toUpperCase(),
      url: typeof url === 'string' ? url : String(url),
      headers: {},
    };
    (origOpen as (...a: unknown[]) => void).call(this, method, url, ...rest);
  } as typeof X.open;

  X.setRequestHeader = function peekSetHeader(
    this: PeekXhr,
    name: string,
    value: string,
    ...rest: unknown[]
  ): void {
    if (this.__peek) this.__peek.headers[name] = value;
    (origSetHeader as (...a: unknown[]) => void).call(this, name, value, ...rest);
  } as typeof X.setRequestHeader;

  X.send = function peekSend(
    this: PeekXhr,
    body?: Document | XMLHttpRequestBodyInit | null,
    ...rest: unknown[]
  ): void {
    const meta = this.__peek;
    if (meta) {
      try {
        postNet({
          kind: 'request',
          id: meta.id,
          ts: now(),
          transport: 'xhr',
          method: meta.method,
          url: meta.url,
          headers: meta.headers,
          ...(body != null ? { requestBody: capBody(String(body)) } : {}),
        });
      } catch {
        /* ignore */
      }
      this.addEventListener('loadend', () => {
        try {
          const text = typeof this.responseText === 'string' ? this.responseText : '';
          postNet({
            kind: 'response',
            id: meta.id,
            ts: now(),
            status: this.status,
            responseBody: capBody(text),
          });
        } catch {
          /* responseText throws for non-text responseType — skip body */
          postNet({ kind: 'response', id: meta.id, ts: now(), status: this.status });
        }
      });
    }
    (origSend as (...a: unknown[]) => void).call(this, body, ...rest);
  } as typeof X.send;
})();
