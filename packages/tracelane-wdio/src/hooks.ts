// traceLaneHooks — the hook-factory alternative to the Service (Task 2.15 /
// ADR-0004 / P1 PRD §M.2).
//
// For users who can't (or don't want to) register a Service, this returns the
// same capture logic as plain `wdio.conf.ts` hook functions wired to one shared
// TraceLaneSession:
//
//   const tracelane = traceLaneHooks({ mode: 'failed', outDir: './tracelane-reports' })
//   export const config = { before: tracelane.before, afterTest: tracelane.afterTest, ... }
//
// It is published at the `@tracelane/wdio/hooks` subpath so the Service stays the
// default, discoverable surface.

import type { Frameworks } from '@wdio/types';
import type { TraceLaneOptions } from './options';
import { TraceLaneSession } from './tracelane-session';
import type { WdioBrowser } from './wdio-executor';

/** Options for {@link traceLaneHooks}. Same shape as the Service options. */
export interface TraceLaneHookOptions extends TraceLaneOptions {
  /**
   * Test framework, so the result-shape switch (P1 PRD §A.2) is correct. The
   * Service reads this from `config.framework`; the hook factory has no config
   * arg, so pass it here (default `'mocha'`).
   */
  framework?: string;
}

/** The bound hook functions returned by {@link traceLaneHooks}. */
export interface TraceLaneHooks {
  beforeSession(config: unknown, capabilities: unknown, specs: string[], cid?: string): void;
  before(capabilities: unknown, specs: string[], browser: WebdriverIO.Browser): Promise<void>;
  beforeSuite(suite: Frameworks.Suite): void;
  beforeTest(test: Frameworks.Test, context?: unknown): Promise<void>;
  beforeCommand(commandName: string, args: unknown[]): Promise<void>;
  afterTest(test: Frameworks.Test, context: unknown, result: Frameworks.TestResult): Promise<void>;
  afterSuite(suite: Frameworks.Suite): void;
  after(result: number, capabilities: unknown, specs: string[]): Promise<void>;
  onComplete(exitCode: number, config: unknown, capabilities: unknown, results: unknown): void;
}

/** A WDIO `Test`/`Suite`-shaped object (we read `title`/`file`). */
interface TestLike {
  title?: string;
  fullTitle?: string;
  file?: string;
}

function testIdentity(test: TestLike): { title: string; spec?: string } {
  const title = test.fullTitle ?? test.title ?? 'unknown test';
  return test.file ? { title, spec: test.file } : { title };
}

/**
 * Build a set of WDIO hook functions wired to one TraceLaneSession (P1 PRD §M.2).
 * Returns the same logic the Service runs — just as standalone hooks.
 */
export function traceLaneHooks(options: TraceLaneHookOptions = {}): TraceLaneHooks {
  const session = new TraceLaneSession(options, options.framework ?? 'mocha');

  return {
    beforeSession(_config, _capabilities, _specs, cid) {
      session.setCid(cid);
    },
    async before(_capabilities, _specs, browser) {
      await session.onBefore(browser as unknown as WdioBrowser);
    },
    beforeSuite(_suite) {},
    async beforeTest(test, _context) {
      const { title, spec } = testIdentity(test as TestLike);
      await session.onBeforeTest(title, spec);
    },
    async beforeCommand(commandName, args) {
      if (commandName === 'url' && typeof args[0] === 'string') {
        await session.onUrl(args[0]);
      }
    },
    async afterTest(_test, _context, result) {
      await session.onAfterTest(result);
    },
    afterSuite(_suite) {},
    async after(_result, _capabilities, _specs) {
      await session.onAfter();
    },
    onComplete(_exitCode, _config, _capabilities, _results) {},
  };
}
