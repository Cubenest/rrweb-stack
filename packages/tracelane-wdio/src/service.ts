// TraceLaneService — the WebdriverIO Service (Task 2.14 / ADR-0004).
//
// Registered in `wdio.conf.ts` as `services: [[TraceLaneService, options]]`
// (P1 PRD §M.1). A Service — not a Reporter — because only the Service hook
// surface gives a live `browser` in worker hooks, which tracelane needs to
// inject rrweb, drain the in-page buffer, and attach CDP (ADR-0004).
//
// All real work is delegated to a single TraceLaneSession so the Service and the
// `traceLaneHooks` factory (hooks.ts) share one implementation.

import type { Frameworks, Services } from '@wdio/types';
import type { TraceLaneOptions } from './options';
import { TraceLaneSession } from './tracelane-session';
import type { WdioBrowser } from './wdio-executor';

/** A WDIO `Test`/`Suite`-shaped object (we read `title`/`file`). */
interface TestLike {
  title?: string;
  fullTitle?: string;
  file?: string;
  parent?: string;
}

/** Pull a human title + spec path out of a WDIO Test/Suite object. */
function testIdentity(test: TestLike): { title: string; spec?: string } {
  const title = test.fullTitle ?? test.title ?? 'unknown test';
  return test.file ? { title, spec: test.file } : { title };
}

/**
 * The tracelane WebdriverIO Service. Implements the worker + launcher hooks from
 * `Services.ServiceInstance`; extra Cucumber hooks (`beforeScenario` /
 * `afterScenario`) are declared as plain methods since `@wdio/types` doesn't put
 * them on `ServiceInstance` (they only exist at runtime under the Cucumber
 * framework).
 */
export default class TraceLaneService implements Services.ServiceInstance {
  private readonly session: TraceLaneSession;

  /**
   * WDIO instantiates the Service with `(options, capabilities, config)`. We
   * read `config.framework` so the result-shape switch (P1 PRD §A.2) picks the
   * right normalization, and `config.outputDir`-adjacent options come from the
   * `options` arg.
   */
  constructor(
    options: TraceLaneOptions = {},
    _capabilities?: unknown,
    config?: { framework?: string },
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
    const pickle = (world as { pickle?: { name?: string; uri?: string } }).pickle;
    const title = pickle?.name ?? 'unknown scenario';
    await this.session.onBeforeTest(title, pickle?.uri);
  }

  /** Cucumber: scenario end (runtime-only hook; mirrors `afterTest`). */
  async afterScenario(world: unknown, result?: unknown): Promise<void> {
    await this.session.onAfterTest(world, result);
  }

  /** Re-inject the recorder after a `url(...)` navigation (ADR-0006). */
  async beforeCommand(commandName: string, args: unknown[]): Promise<void> {
    if (commandName === 'url' && typeof args[0] === 'string') {
      await this.session.onUrl(args[0]);
    }
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
