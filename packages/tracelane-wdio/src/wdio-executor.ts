// Adapts a WebdriverIO `browser` object to @tracelane/core's BrowserExecutor
// (ADR-0004). @tracelane/core only ever talks to a BrowserExecutor — never to a
// concrete framework driver — so this is the single seam between WDIO and the
// recorder engine.

import type { BrowserExecutor } from '@tracelane/core';

/**
 * The structural subset of a WebdriverIO `browser` the adapter needs.
 *
 * `execute` / `executeAsync` are core commands; `cdp` and CDP-event `on(...)`
 * are contributed by `@wdio/devtools-service` and are therefore typed loosely
 * here (the base `WebdriverIO.Browser` type doesn't declare `cdp`, and its `on`
 * is constrained to the Bidi event map). We accept this minimal shape so the
 * adapter stays decoupled from the devtools-service type augmentation, which the
 * user installs separately (P1 PRD §A.5).
 */
export interface WdioBrowser {
  execute<T>(fn: (...args: unknown[]) => T, ...args: unknown[]): Promise<T>;
  executeAsync<T>(fn: (...args: unknown[]) => void, ...args: unknown[]): Promise<T>;
  cdp?(domain: string, command: string, params?: Record<string, unknown>): Promise<unknown>;
  on(event: string, handler: (param: never) => void): unknown;
}

/**
 * Wrap a WDIO `browser` as a {@link BrowserExecutor}.
 *
 * The mapping is 1:1 for `execute` / `executeAsync` / `on`. For `cdp` we throw a
 * clear error if the running session has no `cdp` command — that means
 * `@wdio/devtools-service` wasn't registered (or the driver/vendor doesn't
 * expose CDP), which is the most common network-capture misconfiguration.
 */
export function createWdioExecutor(browser: WdioBrowser): BrowserExecutor {
  return {
    execute<T>(fn: (...args: unknown[]) => T, ...args: unknown[]): Promise<T> {
      return browser.execute<T>(fn, ...args);
    },
    executeAsync<T>(fn: (...args: unknown[]) => void, ...args: unknown[]): Promise<T> {
      return browser.executeAsync<T>(fn, ...args);
    },
    cdp(domain: string, command: string, params?: Record<string, unknown>): Promise<unknown> {
      if (typeof browser.cdp !== 'function') {
        return Promise.reject(
          new Error(
            "@tracelane/wdio: browser.cdp is unavailable. Register '@wdio/devtools-service' " +
              'in your wdio.conf services to enable CDP network capture (P1 PRD §A.5), ' +
              'or disable it via capture.network = false.',
          ),
        );
      }
      // `params` is optional on BrowserExecutor; only forward it when provided so
      // we match `browser.cdp(domain, command)` arity when there are no params.
      return params === undefined
        ? browser.cdp(domain, command)
        : browser.cdp(domain, command, params);
    },
    on(event: string, handler: (params: unknown) => void): void {
      // WDIO's `on` returns the browser for chaining; BrowserExecutor.on is void.
      browser.on(event, handler as (param: never) => void);
    },
  };
}
