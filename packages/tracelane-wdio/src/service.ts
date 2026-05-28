// TraceLaneService — the WebdriverIO Service (Task 2.14 / ADR-0004).
//
// Registered in `wdio.conf.ts` as `services: [[TraceLaneService, options]]`
// (P1 PRD §M.1). A Service — not a Reporter — because only the Service hook
// surface gives a live `browser` in worker hooks, which tracelane needs to
// inject rrweb, drain the in-page buffer, and attach CDP (ADR-0004).
//
// All real work is delegated to a single TraceLaneSession so the Service and the
// `traceLaneHooks` factory (hooks.ts) share one implementation.

import type { Capabilities, Frameworks, Options, Services } from '@wdio/types';
import type { TraceLaneOptions } from './options.js';
import { type TestLike, scenarioIdentity, testIdentity } from './test-identity.js';
import { TraceLaneSession } from './tracelane-session.js';
import type { WdioBrowser } from './wdio-executor.js';

/**
 * The tracelane WebdriverIO Service. Implements the worker + launcher hooks from
 * `Services.ServiceInstance`; extra Cucumber hooks (`beforeScenario` /
 * `afterScenario`) are declared as plain methods since `@wdio/types` doesn't put
 * them on `ServiceInstance` (they only exist at runtime under the Cucumber
 * framework).
 *
 * The constructor signature deliberately matches `Services.ServiceClass`:
 *   `new (options: WebdriverIO.ServiceOption,
 *         capabilities: ResolvedTestrunnerCapabilities,
 *         config: Options.Testrunner): ServiceInstance`
 * (T-4 fix, 2026-05-28 QA walk). Earlier intersection-typing on `options` was
 * not enough — the `capabilities` and `config` parameters had to ALSO be
 * compatible with the interface, otherwise registering the class as
 * `services: [[TraceLaneService, { ... }]]` raised the "not assignable to
 * ServiceClass" error in the user's wdio.conf.ts. With the full triple in
 * place the tuple form typechecks without `@ts-expect-error`.
 */
export default class TraceLaneService implements Services.ServiceInstance {
  private readonly session: TraceLaneSession;

  /**
   * WDIO instantiates the Service with `(options, capabilities, config)`. We
   * read `config.framework` so the result-shape switch (P1 PRD §A.2) picks the
   * right normalization. `capabilities` is accepted for ServiceClass
   * compatibility but unused (the live browser arrives in the `before` hook).
   */
  constructor(
    options: TraceLaneOptions & WebdriverIO.ServiceOption = {},
    _capabilities?: Capabilities.ResolvedTestrunnerCapabilities,
    config?: Options.Testrunner,
  ) {
    this.session = new TraceLaneSession(options, config?.framework);
  }

  /** Refine the framework + worker id once the session is initializing. */
  beforeSession(_config: unknown, _capabilities: unknown, _specs: string[], cid?: string): void {
    this.session.setCid(cid);
  }

  /** Worker hook: stash the live browser + build the recorder. */
  async before(
    _capabilities: unknown,
    _specs: string[],
    browser: WebdriverIO.Browser,
  ): Promise<void> {
    await this.session.onBefore(browser as unknown as WdioBrowser);
  }

  /** No-op in v1; present for the documented hook surface (ADR-0004). */
  beforeSuite(_suite: Frameworks.Suite): void {}

  /** Mocha/Jasmine: start capture and remember the test identity. */
  async beforeTest(test: Frameworks.Test, _context: unknown): Promise<void> {
    const { title, spec } = testIdentity(test as TestLike);
    await this.session.onBeforeTest(title, spec);
  }

  /** Mocha/Jasmine: decide + write the report from the per-test result. */
  async afterTest(
    _test: Frameworks.Test,
    _context: unknown,
    result: Frameworks.TestResult,
  ): Promise<void> {
    await this.session.onAfterTest(result);
  }

  /** Cucumber: scenario start (runtime-only hook; mirrors `beforeTest`). */
  async beforeScenario(world: unknown, _context?: unknown): Promise<void> {
    const { title, spec } = scenarioIdentity(world);
    await this.session.onBeforeTest(title, spec);
  }

  /** Cucumber: scenario end (runtime-only hook; mirrors `afterTest`). */
  async afterScenario(world: unknown, result?: unknown): Promise<void> {
    await this.session.onAfterTest(world, result);
  }

  /**
   * Re-inject the recorder AFTER a `url(...)` navigation (ADR-0006, T-9 fix).
   *
   * WDIO's `beforeCommand` fires before the command executes; if we re-inject
   * there, the page is about to be torn down and Chrome's load of the new URL
   * destroys the just-injected rrweb instance + the `__tracelane__events`
   * buffer. By the time the test starts interacting nothing is recording.
   *
   * `afterCommand` fires after WDIO returns from `url(...)`, which only
   * happens once Chrome has navigated and the document has loaded. Injecting
   * here lands rrweb on the NEW page, where it can observe DOM mutations,
   * console output, and fetches.
   *
   * Errors from the command itself (e.g. a malformed URL) skip re-injection —
   * if the navigation failed, the page never changed and the existing
   * recorder (if any) is still attached to the old page; this is a no-op.
   */
  async afterCommand(
    commandName: string,
    args: unknown[],
    _result: unknown,
    error?: Error,
  ): Promise<void> {
    if (commandName !== 'url' || typeof args[0] !== 'string') return;
    if (error !== undefined) return;
    await this.session.onUrl(args[0]);
  }

  /** No-op in v1; present for the documented hook surface (ADR-0004). */
  afterSuite(_suite: Frameworks.Suite): void {}

  /** Worker teardown: stop the drain poll so no timer leaks. */
  async after(_result: number, _capabilities: unknown, _specs: string[]): Promise<void> {
    await this.session.onAfter();
  }

  /** Launcher hook: nothing to aggregate in v1 (reports are per-test files). */
  onComplete(
    _exitCode: number,
    _config: unknown,
    _capabilities: unknown,
    _results: unknown,
  ): void {}
}
