// Framework-agnostic rrweb network capture plugin.
//
// Adapted from PostHog's `network-plugin.ts` (Apache-2.0). The chain of
// vendoring + attribution is logged in NOTICE.
//
// Trimmed differences vs PostHog's version (PR #1689's draft):
//   - Drops `@posthog/core` type-guard imports; inlines minimal ones.
//   - Drops `createLogger` — substrate stays silent; consumers wrap
//     `maskRequestFn` if they want logging.
//   - Drops `convertToURL` / `formDataToQuery` heavy utilities; inlines
//     the FormData → query stringifier (5 LOC).
//   - The default `maskRequestFn` (when consumer doesn't override) pipes
//     headers through {@link redactNetworkHeaders} and bodies through
//     {@link redactBody}. The consumer's `maskRequestFn` (if any) runs
//     AFTER the default mask — defense in depth.
//   - The `initialisedHandler` module-level singleton is preserved
//     verbatim; same teardown contract.

/// <reference lib="dom" />

import type { IWindow, RecordPlugin, listenerHandler } from '@posthog/rrweb-types';
import { redactBody } from '../../masking/body.js';
import { redactNetworkHeaders } from '../../masking/headers.js';
import { type DefaultedNetworkOptions, defaultNetworkOptions } from './defaults.js';
import { patch } from './patch.js';
import {
  type CapturedNetworkRequest,
  type InitiatorType,
  NETWORK_PLUGIN_NAME,
  type NetworkData,
  type NetworkHeaders,
  type NetworkRecordOptions,
} from './types.js';

// ─── Minimal type guards (replaces @posthog/core) ────────────────────────────

const isArray = Array.isArray;
const isString = (v: unknown): v is string => typeof v === 'string';
const isBoolean = (v: unknown): v is boolean => typeof v === 'boolean';
const isUndefined = (v: unknown): v is undefined => typeof v === 'undefined';
const isNull = (v: unknown): v is null => v === null;
const isNullish = (v: unknown): v is null | undefined => v == null;
const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
const isFormData = (v: unknown): v is FormData =>
  typeof FormData !== 'undefined' && v instanceof FormData;
const isDocument = (v: unknown): v is Document =>
  typeof Document !== 'undefined' && v instanceof Document;

// ─── Local utilities (replaces formDataToQuery / denylist / logger) ─────────

/**
 * `FormData` → query string. Defensive serialization for request body
 * capture; File parts emit their filename so the redaction layer can
 * see SOMETHING without trying to read the bytes.
 */
function formDataToQuery(formData: FormData): string {
  const params = new URLSearchParams();
  formData.forEach((value, key) => {
    if (typeof value === 'string') {
      params.append(key, value);
    } else if (value && typeof value === 'object' && 'name' in value) {
      params.append(key, `[File: ${(value as File).name}]`);
    } else {
      params.append(key, '[Blob]');
    }
  });
  return params.toString();
}

/**
 * Suffix-match a hostname against the consumer-supplied deny-list.
 * Returns `{ hostname, isHostDenied }` so callers can surface the
 * matched host in the replacement payload.
 */
function isHostOnDenyList(
  url: string | URL | Request,
  options: Pick<NetworkRecordOptions, 'payloadHostDenyList'>,
): { hostname: string | null; isHostDenied: boolean } {
  const hostname = hostnameFromURL(url);
  const denyList = options.payloadHostDenyList ?? [];
  if (denyList.length === 0 || !hostname || hostname.trim().length === 0) {
    return { hostname, isHostDenied: false };
  }
  for (const deny of denyList) {
    if (hostname.endsWith(deny)) {
      return { hostname, isHostDenied: true };
    }
  }
  return { hostname, isHostDenied: false };
}

function hostnameFromURL(url: string | URL | RequestInfo): string | null {
  try {
    if (typeof url === 'string') {
      return new URL(url, getDocumentBase()).hostname;
    }
    if (url instanceof URL) {
      return url.hostname;
    }
    if ('url' in url) {
      return new URL(url.url, getDocumentBase()).hostname;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Provides a base URL for resolving relative URLs. In the browser we use
 * `document.baseURI`; in tests/Node we fall back to an opaque
 * placeholder so `new URL('/foo', base)` resolves rather than throws.
 */
function getDocumentBase(): string {
  try {
    if (typeof document !== 'undefined' && document.baseURI) {
      return document.baseURI;
    }
  } catch {
    /* ignore */
  }
  return 'http://localhost/';
}

/**
 * Best-effort silent logger. Substrate refuses to console.log on the
 * host page; consumers needing diagnostics wrap `maskRequestFn`.
 */
const logger = {
  warn: (_msg?: unknown, _ctx?: unknown): void => {
    /* silent */
  },
  error: (_msg?: unknown, _ctx?: unknown): void => {
    /* silent */
  },
  info: (_msg?: unknown, _ctx?: unknown): void => {
    /* silent */
  },
};

// ─── Performance entry classifiers (verbatim from PostHog) ───────────────────

const isNavigationTiming = (entry: PerformanceEntry): entry is PerformanceNavigationTiming =>
  entry.entryType === 'navigation';

const isResourceTiming = (entry: PerformanceEntry): entry is PerformanceResourceTiming =>
  entry.entryType === 'resource';

type ObservedPerformanceEntry = (PerformanceNavigationTiming | PerformanceResourceTiming) & {
  responseStatus?: number;
};

function findLast<T>(array: Array<T>, predicate: (value: T) => boolean): T | undefined {
  for (let i = array.length - 1; i >= 0; i -= 1) {
    const v = array[i];
    if (v !== undefined && predicate(v)) {
      return v;
    }
  }
  return undefined;
}

// ─── Should-record helpers ───────────────────────────────────────────────────

function shouldRecordHeaders(
  type: 'request' | 'response',
  recordHeaders: NetworkRecordOptions['recordHeaders'],
): boolean {
  if (!recordHeaders) return false;
  if (isBoolean(recordHeaders)) return true;
  return !!recordHeaders[type];
}

export function shouldRecordBody({
  type,
  recordBody,
  headers,
  url,
}: {
  type: 'request' | 'response';
  headers: NetworkHeaders;
  url: string | URL | RequestInfo;
  recordBody: NetworkRecordOptions['recordBody'];
}): boolean {
  function matchesContentType(contentTypes: string[]): boolean {
    const contentTypeHeader = Object.keys(headers).find(
      (key) => key.toLowerCase() === 'content-type',
    );
    const contentType = contentTypeHeader && headers[contentTypeHeader];
    return contentTypes.some((ct) => contentType?.includes(ct));
  }
  function isBlobURL(u: string | URL | RequestInfo): boolean {
    try {
      if (typeof u === 'string') return u.startsWith('blob:');
      if (u instanceof URL) return u.protocol === 'blob:';
      if (typeof Request !== 'undefined' && u instanceof Request) {
        return isBlobURL(u.url);
      }
      return false;
    } catch {
      return false;
    }
  }
  if (!recordBody) return false;
  if (isBlobURL(url)) return false;
  if (isBoolean(recordBody)) return true;
  if (isArray(recordBody)) return matchesContentType(recordBody);
  const recordBodyType = recordBody[type];
  if (isBoolean(recordBodyType)) return recordBodyType;
  return matchesContentType(recordBodyType);
}

// ─── PerformanceObserver path ────────────────────────────────────────────────

type NetworkCallback = (data: NetworkData) => void;

/**
 * Internal, fully-resolved options shape. `Required<NetworkRecordOptions>`
 * doesn't strip `| undefined` from each field because the source types
 * encode optionality explicitly. So we reuse `DefaultedNetworkOptions`
 * — same shape as the defaults — and `normalizeOptions` produces it
 * from defaults + user input.
 */
type NormalizedNetworkOptions = DefaultedNetworkOptions;

function normalizeOptions(opts: NetworkRecordOptions | undefined): NormalizedNetworkOptions {
  return {
    recordInitialRequests:
      opts?.recordInitialRequests ?? defaultNetworkOptions.recordInitialRequests,
    recordHeaders: opts?.recordHeaders ?? defaultNetworkOptions.recordHeaders,
    recordBody: opts?.recordBody ?? defaultNetworkOptions.recordBody,
    recordPerformance: opts?.recordPerformance ?? defaultNetworkOptions.recordPerformance,
    performanceEntryTypeToObserve:
      opts?.performanceEntryTypeToObserve ?? defaultNetworkOptions.performanceEntryTypeToObserve,
    initiatorTypes: opts?.initiatorTypes ?? defaultNetworkOptions.initiatorTypes,
    payloadSizeLimitBytes:
      opts?.payloadSizeLimitBytes ?? defaultNetworkOptions.payloadSizeLimitBytes,
    bodyByteLimit: opts?.bodyByteLimit ?? defaultNetworkOptions.bodyByteLimit,
    maxRequestsPerBatch: opts?.maxRequestsPerBatch ?? defaultNetworkOptions.maxRequestsPerBatch,
    payloadHostDenyList: opts?.payloadHostDenyList ?? defaultNetworkOptions.payloadHostDenyList,
    maskRequestFn: opts?.maskRequestFn ?? defaultNetworkOptions.maskRequestFn,
  };
}

function initPerformanceObserver(
  cb: NetworkCallback,
  win: IWindow,
  options: NormalizedNetworkOptions,
): listenerHandler {
  if (!options.recordPerformance) {
    return () => {
      /* no-op */
    };
  }
  // emit pre-existing entries first (the page-load burst before the
  // recorder attached). Marked isInitial so replay can render them
  // differently — they never carry method/status/headers/body.
  if (options.recordInitialRequests) {
    const initialPerformanceEntries = win.performance
      .getEntries()
      .filter(
        (entry): entry is ObservedPerformanceEntry =>
          isNavigationTiming(entry) ||
          (isResourceTiming(entry) &&
            options.initiatorTypes.includes(entry.initiatorType as InitiatorType)),
      );
    if (initialPerformanceEntries.length > 0) {
      cb({
        requests: initialPerformanceEntries.flatMap((entry) =>
          prepareRequest({
            entry,
            method: undefined,
            status: undefined,
            networkRequest: {},
            isInitial: true,
          }),
        ),
        isInitial: true,
      });
    }
  }
  if (typeof win.PerformanceObserver === 'undefined') {
    return () => {
      /* no-op */
    };
  }
  const observer = new win.PerformanceObserver((entries) => {
    // when fetch/XHR are wrapped (i.e. we capture bodies/headers via
    // the wrappers), avoid double-emit for those initiator types here.
    const wrappedInitiatorFilter = (entry: ObservedPerformanceEntry): boolean =>
      options.recordBody || options.recordHeaders
        ? entry.initiatorType !== 'xmlhttprequest' && entry.initiatorType !== 'fetch'
        : true;

    const performanceEntries = entries
      .getEntries()
      .filter(
        (entry): entry is ObservedPerformanceEntry =>
          isNavigationTiming(entry) ||
          (isResourceTiming(entry) &&
            options.initiatorTypes.includes(entry.initiatorType as InitiatorType) &&
            wrappedInitiatorFilter(entry)),
      );

    if (performanceEntries.length === 0) return;
    cb({
      requests: performanceEntries.flatMap((entry) =>
        prepareRequest({
          entry,
          method: undefined,
          status: undefined,
          networkRequest: {},
        }),
      ),
    });
  });
  const supportedTypes = (win.PerformanceObserver as typeof PerformanceObserver)
    .supportedEntryTypes;
  const entryTypes = supportedTypes.filter((x) =>
    options.performanceEntryTypeToObserve.includes(x),
  );
  if (entryTypes.length === 0) {
    return () => {
      /* no-op */
    };
  }
  observer.observe({ entryTypes });
  return () => {
    observer.disconnect();
  };
}

/**
 * Maximum retry attempts when looking up the PerformanceResourceTiming
 * entry for a fetch/XHR we just wrapped. The browser buffers resource
 * timings asynchronously, so the entry isn't always available the moment
 * the response resolves. PostHog tuned this at 10 attempts × 50*attempt
 * ms — up to ~2.75s. We hold these as mutable bindings so tests can
 * override at module load time via `_setPerfEntryRetryConfigForTests`.
 */
let perfEntryMaxAttempts = 10;
let perfEntryBackoffMs = 50;

/**
 * Test-only — override the retry config. Returns the previous values so
 * tests can restore. Not exported from the public barrel.
 */
export function _setPerfEntryRetryConfigForTests(
  maxAttempts: number,
  backoffMs: number,
): { previousMax: number; previousBackoff: number } {
  const previousMax = perfEntryMaxAttempts;
  const previousBackoff = perfEntryBackoffMs;
  perfEntryMaxAttempts = maxAttempts;
  perfEntryBackoffMs = backoffMs;
  return { previousMax, previousBackoff };
}

async function getRequestPerformanceEntry(
  win: IWindow,
  initiatorType: string,
  url: string,
  start?: number,
  end?: number,
  attempt = 0,
): Promise<PerformanceResourceTiming | null> {
  if (attempt > perfEntryMaxAttempts) {
    logger.warn('Failed to get performance entry for request', { url, initiatorType });
    return null;
  }
  if (!win.performance || typeof win.performance.getEntriesByName !== 'function') {
    return null;
  }
  const urlPerformanceEntries = win.performance.getEntriesByName(
    url,
  ) as PerformanceResourceTiming[];
  const performanceEntry = findLast(
    urlPerformanceEntries,
    (entry) =>
      isResourceTiming(entry) &&
      entry.initiatorType === initiatorType &&
      (isUndefined(start) || entry.startTime >= start) &&
      (isUndefined(end) || entry.startTime <= end),
  );
  if (!performanceEntry) {
    await new Promise((resolve) => setTimeout(resolve, perfEntryBackoffMs * attempt));
    return getRequestPerformanceEntry(win, initiatorType, url, start, end, attempt + 1);
  }
  return performanceEntry;
}

// ─── XHR body reader ────────────────────────────────────────────────────────

function _tryReadXHRBody({
  body,
  options,
  url,
}: {
  body: Document | XMLHttpRequestBodyInit | unknown | null | undefined;
  options: NetworkRecordOptions;
  url: string | URL | RequestInfo;
}): string | null {
  if (isNullish(body)) return null;

  const { hostname, isHostDenied } = isHostOnDenyList(url, options);
  if (isHostDenied && hostname) {
    return `${hostname} is in deny list`;
  }

  if (isString(body)) return body;
  if (isDocument(body)) return body.textContent;
  if (isFormData(body)) return formDataToQuery(body);
  if (isObject(body)) {
    try {
      return JSON.stringify(body);
    } catch {
      return '[Cubenest] Failed to stringify response object';
    }
  }
  return `[Cubenest] Cannot read body of type ${Object.prototype.toString.call(body)}`;
}

// ─── XHR observer ────────────────────────────────────────────────────────────

function initXhrObserver(
  cb: NetworkCallback,
  win: IWindow,
  options: NormalizedNetworkOptions,
): listenerHandler {
  if (!options.initiatorTypes.includes('xmlhttprequest' as InitiatorType)) {
    return () => {
      /* no-op */
    };
  }
  if (typeof win.XMLHttpRequest === 'undefined') {
    return () => {
      /* no-op */
    };
  }
  const recordRequestHeaders = shouldRecordHeaders('request', options.recordHeaders);
  const recordResponseHeaders = shouldRecordHeaders('response', options.recordHeaders);

  const restorePatch = patch(
    win.XMLHttpRequest.prototype as unknown as { [key: string]: unknown },
    'open',
    (originalOpenUnknown: unknown) => {
      const originalOpen = originalOpenUnknown as typeof XMLHttpRequest.prototype.open;
      return function (
        this: XMLHttpRequest,
        method: string,
        url: string | URL,
        async = true,
        username?: string | null,
        password?: string | null,
      ) {
        const reqUrlStr = url.toString();
        const networkRequest: Partial<CapturedNetworkRequest> = {};
        let start: number | undefined;
        let end: number | undefined;

        const requestHeaders: NetworkHeaders = {};
        const originalSetRequestHeader = this.setRequestHeader.bind(this);
        this.setRequestHeader = (header: string, value: string) => {
          requestHeaders[header] = value;
          return originalSetRequestHeader(header, value);
        };
        if (recordRequestHeaders) {
          networkRequest.requestHeaders = requestHeaders;
        }

        const originalSend = this.send.bind(this);
        this.send = (body) => {
          if (
            shouldRecordBody({
              type: 'request',
              headers: requestHeaders,
              url,
              recordBody: options.recordBody,
            })
          ) {
            const read = _tryReadXHRBody({ body, options, url });
            if (read !== null) networkRequest.requestBody = read;
          }
          start = win.performance.now();
          return originalSend(body);
        };

        // Cleanup function to remove all event listeners and prevent memory leaks.
        const cleanup = () => {
          this.removeEventListener('readystatechange', readyStateListener);
          this.removeEventListener('error', cleanup);
          this.removeEventListener('abort', errorCleanup);
          this.removeEventListener('timeout', cleanup);
        };

        // For aborted/errored requests, emit a synthetic record so the
        // replay panel still shows the attempt. Preserves PostHog's
        // behavior of cleaning listeners + recording status=0.
        const errorCleanup = () => {
          if (start !== undefined && end === undefined) {
            end = win.performance.now();
            void getRequestPerformanceEntry(win, 'xmlhttprequest', reqUrlStr, start, end)
              .then((entry) => {
                const requests = prepareRequest({
                  entry,
                  method,
                  status: this.status || 0,
                  networkRequest,
                  start,
                  end,
                  url: reqUrlStr,
                  initiatorType: 'xmlhttprequest',
                });
                cb({ requests });
              })
              .catch(() => {
                /* ignore */
              });
          }
          cleanup();
        };

        const readyStateListener = () => {
          if (this.readyState !== this.DONE) {
            return;
          }
          cleanup();

          end = win.performance.now();
          const responseHeaders: NetworkHeaders = {};
          const rawHeaders = this.getAllResponseHeaders();
          const headers = rawHeaders.trim().split(/[\r\n]+/);
          for (const line of headers) {
            const parts = line.split(': ');
            const header = parts.shift();
            const value = parts.join(': ');
            if (header) {
              responseHeaders[header] = value;
            }
          }
          if (recordResponseHeaders) {
            networkRequest.responseHeaders = responseHeaders;
          }
          if (
            shouldRecordBody({
              type: 'response',
              headers: responseHeaders,
              url,
              recordBody: options.recordBody,
            })
          ) {
            const read = _tryReadXHRBody({ body: this.response, options, url });
            if (read !== null) networkRequest.responseBody = read;
          }
          void getRequestPerformanceEntry(win, 'xmlhttprequest', reqUrlStr, start, end)
            .then((entry) => {
              const requests = prepareRequest({
                entry,
                method,
                status: this.status,
                networkRequest,
                start,
                end,
                url: reqUrlStr,
                initiatorType: 'xmlhttprequest',
              });
              cb({ requests });
            })
            .catch(() => {
              /* ignore */
            });
        };

        this.addEventListener('readystatechange', readyStateListener);
        this.addEventListener('error', errorCleanup);
        this.addEventListener('abort', errorCleanup);
        this.addEventListener('timeout', errorCleanup);

        originalOpen.call(this, method, reqUrlStr, async, username, password);
      };
    },
  );
  return () => {
    restorePatch();
  };
}

// ─── Fetch body readers ──────────────────────────────────────────────────────

const contentTypePrefixDenyList = ['video/', 'audio/'];

function _checkForCannotReadResponseBody({
  r,
  options,
  url,
}: {
  r: Response;
  options: NetworkRecordOptions;
  url: string | URL | RequestInfo;
}): string | null {
  if (r.headers.get('Transfer-Encoding') === 'chunked') {
    return 'Chunked Transfer-Encoding is not supported';
  }
  const contentType = r.headers.get('Content-Type')?.toLowerCase();
  const contentTypeIsDenied = contentTypePrefixDenyList.some((prefix) =>
    contentType?.startsWith(prefix),
  );
  if (contentType && contentTypeIsDenied) {
    return `Content-Type ${contentType} is not supported`;
  }
  const { hostname, isHostDenied } = isHostOnDenyList(url, options);
  if (isHostDenied && hostname) {
    return `${hostname} is in deny list`;
  }
  return null;
}

function _tryReadBody(r: Request | Response): Promise<string> {
  return new Promise((resolve) => {
    const timeout = setTimeout(() => resolve('[Cubenest] Timeout while trying to read body'), 500);
    try {
      r.clone()
        .text()
        .then(
          (txt) => resolve(txt),
          (reason) => resolve(`[Cubenest] Failed to read body: ${String(reason)}`),
        )
        .finally(() => clearTimeout(timeout));
    } catch {
      clearTimeout(timeout);
      resolve('[Cubenest] Failed to read body');
    }
  });
}

async function _tryReadRequestBody({
  r,
  options,
  url,
}: {
  r: Request;
  options: NetworkRecordOptions;
  url: string | URL | RequestInfo;
}): Promise<string> {
  const { hostname, isHostDenied } = isHostOnDenyList(url, options);
  if (isHostDenied && hostname) {
    return Promise.resolve(`${hostname} is in deny list`);
  }
  return _tryReadBody(r);
}

async function _tryReadResponseBody({
  r,
  options,
  url,
}: {
  r: Response;
  options: NetworkRecordOptions;
  url: string | URL | RequestInfo;
}): Promise<string> {
  const cannot = _checkForCannotReadResponseBody({ r, options, url });
  if (!isNull(cannot)) return Promise.resolve(cannot);
  return _tryReadBody(r);
}

// ─── Fetch observer ──────────────────────────────────────────────────────────

function initFetchObserver(
  cb: NetworkCallback,
  win: IWindow,
  options: NormalizedNetworkOptions,
): listenerHandler {
  if (!options.initiatorTypes.includes('fetch' as InitiatorType)) {
    return () => {
      /* no-op */
    };
  }
  if (typeof win.fetch === 'undefined') {
    return () => {
      /* no-op */
    };
  }
  const recordRequestHeaders = shouldRecordHeaders('request', options.recordHeaders);
  const recordResponseHeaders = shouldRecordHeaders('response', options.recordHeaders);

  const restorePatch = patch(
    win as unknown as { [key: string]: unknown },
    'fetch',
    (originalFetchUnknown: unknown) => {
      const originalFetch = originalFetchUnknown as typeof fetch;
      return async (url: URL | RequestInfo, init?: RequestInit | undefined): Promise<Response> => {
        // Defensive: if `url` is a string and the Request constructor
        // would reject it as a relative URL (some envs — Node/jsdom —
        // require absolute), resolve against the document base first.
        let req: Request;
        try {
          req = new Request(url as RequestInfo, init);
        } catch {
          const resolved =
            typeof url === 'string' ? new URL(url, getDocumentBase()).toString() : url;
          req = new Request(resolved as RequestInfo, init);
        }
        let res: Response | undefined;
        const networkRequest: Partial<CapturedNetworkRequest> = {};
        let start: number | undefined;
        let end: number | undefined;

        try {
          const requestHeaders: NetworkHeaders = {};
          req.headers.forEach((value: string, header: string) => {
            requestHeaders[header] = value;
          });
          if (recordRequestHeaders) {
            networkRequest.requestHeaders = requestHeaders;
          }
          if (
            shouldRecordBody({
              type: 'request',
              headers: requestHeaders,
              url,
              recordBody: options.recordBody,
            })
          ) {
            networkRequest.requestBody = await _tryReadRequestBody({
              r: req,
              options,
              url,
            });
          }

          start = win.performance.now();
          res = await originalFetch(req);
          end = win.performance.now();

          const responseHeaders: NetworkHeaders = {};
          res.headers.forEach((value: string, header: string) => {
            responseHeaders[header] = value;
          });
          if (recordResponseHeaders) {
            networkRequest.responseHeaders = responseHeaders;
          }
          if (
            shouldRecordBody({
              type: 'response',
              headers: responseHeaders,
              url,
              recordBody: options.recordBody,
            })
          ) {
            networkRequest.responseBody = await _tryReadResponseBody({
              r: res,
              options,
              url,
            });
          }

          return res;
        } catch (err) {
          // Network-level error (CORS, offline, abort). Emit a status=0
          // record so the replay panel still shows the attempt, then
          // re-throw so the consumer's catch handler gets the original
          // exception.
          if (start !== undefined && end === undefined) {
            end = win.performance.now();
          }
          const requests = prepareRequest({
            entry: null,
            method: req.method,
            status: 0,
            networkRequest,
            start,
            end,
            url: req.url,
            initiatorType: 'fetch',
          });
          cb({ requests });
          throw err;
        } finally {
          if (res !== undefined) {
            void getRequestPerformanceEntry(win, 'fetch', req.url, start, end)
              .then((entry) => {
                const requests = prepareRequest({
                  entry,
                  method: req.method,
                  status: res?.status,
                  networkRequest,
                  start,
                  end,
                  url: req.url,
                  initiatorType: 'fetch',
                });
                cb({ requests });
              })
              .catch(() => {
                /* ignore */
              });
          }
        }
      };
    },
  );
  return () => {
    restorePatch();
  };
}

// ─── Prepare-request shape normalization ─────────────────────────────────────

const exposesServerTiming = (event: PerformanceEntry | null): event is PerformanceResourceTiming =>
  !isNull(event) && (event.entryType === 'navigation' || event.entryType === 'resource');

interface PrepareRequestArgs {
  entry: PerformanceResourceTiming | null;
  method: string | undefined;
  status: number | undefined;
  networkRequest: Partial<CapturedNetworkRequest>;
  isInitial?: boolean | undefined;
  start?: number | undefined;
  end?: number | undefined;
  url?: string | undefined;
  initiatorType?: string | undefined;
}

function prepareRequest(args: PrepareRequestArgs): CapturedNetworkRequest[] {
  const { entry, method, status, networkRequest, isInitial, url, initiatorType } = args;
  const start = entry ? entry.startTime : args.start;
  const end = entry ? entry.responseEnd : args.end;

  const timeOrigin = Math.floor(Date.now() - performance.now());
  const timestamp = Math.floor(timeOrigin + (start || 0));

  const entryJSON: Record<string, unknown> = entry ? entry.toJSON() : { name: url ?? '' };

  const baseName = typeof entryJSON.name === 'string' ? entryJSON.name : (url ?? '');

  // Order matters: the spread of `entryJSON` is FIRST so explicit fields
  // below (method/status/headers/body/isInitial) take precedence over
  // anything the browser puts into `toJSON()`.
  const baseRequest: CapturedNetworkRequest = {
    ...entryJSON,
    name: baseName,
    startTime: isUndefined(start) ? undefined : Math.round(start),
    endTime: isUndefined(end) ? undefined : Math.round(end),
    timeOrigin,
    timestamp,
    method,
    initiatorType: initiatorType
      ? initiatorType
      : entry
        ? (entry.initiatorType as InitiatorType)
        : undefined,
    status,
    requestHeaders: networkRequest.requestHeaders,
    requestBody: networkRequest.requestBody,
    responseHeaders: networkRequest.responseHeaders,
    responseBody: networkRequest.responseBody,
    isInitial,
    duration: entry?.duration,
    transferSize:
      entry && 'transferSize' in entry
        ? (entry as PerformanceResourceTiming).transferSize
        : undefined,
  };

  const requests: CapturedNetworkRequest[] = [baseRequest];

  if (exposesServerTiming(entry)) {
    for (const timing of entry.serverTiming || []) {
      requests.push({
        timeOrigin,
        timestamp,
        startTime: Math.round(entry.startTime),
        name: timing.name,
        duration: timing.duration,
        // Synthetic entry type so consumers can correlate to a parent
        // navigation/resource by timestamp + URL.
        entryType: 'serverTiming',
      });
    }
  }

  return requests;
}

// ─── Default mask: pipes through redactNetworkHeaders + redactBody ─────────

const REDACTED_VALUE = '<<REDACTED>>';
const URL_REDACTED_PARAMS = new Set([
  'token',
  'access_token',
  'refresh_token',
  'api_key',
  'apikey',
  'auth',
  'password',
  'secret',
  'sessionid',
  'session_id',
]);

/**
 * Redact common credential-shaped query-string params in `url`. Leaves
 * the path + non-matching params intact. Used by {@link buildDefaultMask}
 * so a default install doesn't leak `?token=…` URLs to the recorder.
 */
function redactUrl(url: string): string {
  try {
    // URL constructor needs an absolute URL; provide a base so relative
    // URLs still parse. Re-stringify; relative URLs round-trip cleanly
    // by stripping the base back off.
    const isAbsolute = /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(url);
    const base = isAbsolute ? undefined : getDocumentBase();
    const parsed = new URL(url, base);
    let touched = false;
    parsed.searchParams.forEach((_, name) => {
      if (URL_REDACTED_PARAMS.has(name.toLowerCase())) {
        parsed.searchParams.set(name, REDACTED_VALUE);
        touched = true;
      }
    });
    if (!touched) return url;
    if (isAbsolute) return parsed.toString();
    // Strip base back off to preserve the relative form.
    return parsed.pathname + parsed.search + parsed.hash;
  } catch {
    return url;
  }
}

/**
 * Build the default mask. Pipes through:
 *   - URL → `redactUrl` (query-string credential params)
 *   - Headers → `redactNetworkHeaders` (deny-list values)
 *   - Bodies → `redactBody` (PII regex bank + truncation), then enforces
 *     `bodyByteLimit` as a final cap.
 *
 * Returns the modified request — never returns `null`. (Consumer
 * `maskRequestFn` may return null to skip emission entirely.)
 */
function buildDefaultMask(
  options: Pick<NetworkRecordOptions, 'bodyByteLimit' | 'payloadSizeLimitBytes'>,
): (req: CapturedNetworkRequest) => CapturedNetworkRequest {
  const bodyLimit = options.bodyByteLimit ?? 5_000;
  const totalLimit = options.payloadSizeLimitBytes ?? 1_000_000;

  // Body truncation: redactBody itself can truncate, but we want a
  // separate per-direction cap so consumers can opt into a tighter
  // limit without rewriting the whole regex bank. The smaller of
  // bodyByteLimit and payloadSizeLimitBytes wins (defense in depth).
  const limit = Math.min(bodyLimit, totalLimit);

  const maskBody = (body: string | undefined): string | undefined => {
    if (body === undefined) return undefined;
    const masked = redactBody(body, { maxLengthBytes: limit });
    return masked;
  };

  return (req: CapturedNetworkRequest): CapturedNetworkRequest => ({
    ...req,
    name: redactUrl(req.name),
    requestHeaders: req.requestHeaders ? redactNetworkHeaders(req.requestHeaders) : undefined,
    responseHeaders: req.responseHeaders ? redactNetworkHeaders(req.responseHeaders) : undefined,
    requestBody: maskBody(req.requestBody),
    responseBody: maskBody(req.responseBody),
  });
}

// ─── Observer install + teardown ─────────────────────────────────────────────

let initialisedHandler: listenerHandler | null = null;

function initNetworkObserver(
  callback: NetworkCallback,
  win: IWindow,
  options: NetworkRecordOptions,
): listenerHandler {
  if (!('performance' in win)) {
    return () => {
      /* no-op */
    };
  }

  if (initialisedHandler) {
    logger.warn('Network observer already initialised, doing nothing');
    return () => {
      /* the first caller already owns the teardown */
    };
  }

  const networkOptions = normalizeOptions(options);

  const defaultMask = buildDefaultMask(networkOptions);
  const consumerMask = networkOptions.maskRequestFn;
  const hasConsumerMask = consumerMask !== defaultNetworkOptions.maskRequestFn;
  // If the consumer-supplied mask is the identity default we use a
  // simple wrapper; otherwise compose `defaultMask` then `consumerMask`.
  const composedMask = (req: CapturedNetworkRequest): CapturedNetworkRequest | null => {
    const afterDefault = defaultMask(req);
    if (!hasConsumerMask) {
      return afterDefault;
    }
    const afterConsumer = consumerMask(afterDefault);
    if (isNullish(afterConsumer)) return null;
    return afterConsumer;
  };

  let inflightCount = 0;
  const cb: NetworkCallback = (data) => {
    const requests: CapturedNetworkRequest[] = [];
    for (const request of data.requests) {
      // Drop overflow within a single batch so a noisy resource flush
      // never balloons the emitted event.
      if (inflightCount >= networkOptions.maxRequestsPerBatch) {
        break;
      }
      const masked = composedMask(request);
      if (masked) {
        requests.push(masked);
        inflightCount += 1;
      }
    }

    if (requests.length > 0) {
      callback({ ...data, requests });
    }
  };

  // Reset the inflight counter on every "tick" so the cap is per-flush,
  // not all-time. We hook into queueMicrotask so the counter resets in
  // a defined order relative to the wrappers.
  const resetCounter = () => {
    inflightCount = 0;
  };
  const counterTimer = setInterval(resetCounter, 1_000);

  const performanceObserver = initPerformanceObserver(cb, win, networkOptions);

  // Only install the body-capturing wrappers when bodies or headers are
  // requested — the PerformanceObserver path alone yields no body/header
  // data, so wrapping is wasted work otherwise.
  let xhrObserver: listenerHandler = () => {
    /* no-op */
  };
  let fetchObserver: listenerHandler = () => {
    /* no-op */
  };
  if (networkOptions.recordHeaders || networkOptions.recordBody) {
    xhrObserver = initXhrObserver(cb, win, networkOptions);
    fetchObserver = initFetchObserver(cb, win, networkOptions);
  }

  initialisedHandler = () => {
    clearInterval(counterTimer);
    performanceObserver();
    xhrObserver();
    fetchObserver();
    initialisedHandler = null;
  };
  return initialisedHandler;
}

// ─── Public surface ──────────────────────────────────────────────────────────

/**
 * Reset internal state. Test-only — exposed so tests can re-initialize
 * the singleton observer between cases.
 */
export function _resetNetworkObserverForTests(): void {
  initialisedHandler = null;
}

/**
 * Build the rrweb network capture plugin. Pass to `record({ plugins: [
 * getRecordNetworkPlugin() ] })`.
 *
 * Emits `EventType.Plugin` events with `data.plugin === 'rrweb/network@1'`
 * and `data.payload: NetworkData`.
 *
 * @example
 *   record({
 *     emit(event) { … },
 *     plugins: [
 *       getRecordNetworkPlugin({ recordBody: true, recordHeaders: true }),
 *     ],
 *   });
 */
export function getRecordNetworkPlugin(
  options?: NetworkRecordOptions,
): RecordPlugin<NetworkRecordOptions> {
  const observer = (
    cb: (...args: unknown[]) => void,
    win: IWindow,
    opts: NetworkRecordOptions,
  ): listenerHandler => initNetworkObserver(cb as unknown as NetworkCallback, win, opts);
  return {
    name: NETWORK_PLUGIN_NAME,
    observer,
    options: options ?? {},
  };
}
