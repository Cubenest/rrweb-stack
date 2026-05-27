/**
 * The framework-agnostic surface that wraps a per-framework `browser`/`page`
 * object. The wdio / playwright / cypress adapters implement this in their own
 * packages (ADR-0004); `@tracelane/core` only ever talks to a `BrowserExecutor`,
 * never to a concrete framework driver.
 *
 * Modeled on WebdriverIO's `browser` API (P1 PRD §A.4 / §A.5), which is the
 * lowest-common-denominator across the three target frameworks.
 */
export interface BrowserExecutor {
  /**
   * Run `fn` in the page (browser) context and resolve with its return value.
   *
   * The function body is `.toString()`-serialized and evaluated in the page, so
   * (per PRD §A.4) it MUST be self-contained: closures over Node-side variables
   * are silently dropped — always pass values explicitly via `...args`. The
   * return value must be JSON-serializable (no functions, DOM nodes, or
   * circular references).
   */
  execute<T>(fn: (...args: unknown[]) => T, ...args: unknown[]): Promise<T>;

  /**
   * Run an async `fn` in the page context. The injected function receives a
   * trailing `done` callback as its last argument (WebDriver async-script
   * semantics); it resolves the returned promise when `done(value)` is called.
   */
  executeAsync<T>(fn: (...args: unknown[]) => void, ...args: unknown[]): Promise<T>;

  /**
   * Send a Chrome DevTools Protocol command on the active connection
   * (PRD §A.5). Requires a CDP-capable transport (e.g. `@wdio/devtools-service`
   * for WebdriverIO). Resolves with the raw CDP result.
   */
  cdp(domain: string, command: string, params?: Record<string, unknown>): Promise<unknown>;

  /**
   * Subscribe to a CDP event (e.g. `'Network.responseReceived'`) on the same
   * connection used by {@link BrowserExecutor.cdp}.
   */
  on(event: string, handler: (params: unknown) => void): void;
}
