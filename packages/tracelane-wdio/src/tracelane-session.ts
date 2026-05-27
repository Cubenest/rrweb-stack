// The shared per-worker capture session.
//
// Both surfaces — the `TraceLaneService` class (Task 2.14) and the
// `traceLaneHooks` factory (Task 2.15) — delegate to one `TraceLaneSession` so
// the capture/inject/drain/report logic lives in exactly one place (ADR-0004:
// "the same logic exported as plain hook functions"). The session owns the
// recorder, the current-test metadata, and the report-write decision.

import {
  type ConsolePluginOptions,
  type Mode,
  type Recorder,
  createRecorder,
} from '@tracelane/core';
import type { ReportMeta } from '@tracelane/report';
import { type Framework, normalizeResult } from './framework-result.js';
import { loadRrwebBundle } from './inpage-bundle.js';
import { attachNetworkCapture } from './network-capture.js';
import { DEFAULT_OUT_DIR, type TraceLaneOptions } from './options.js';
import { writeReport } from './report-writer.js';
import { type WdioBrowser, createWdioExecutor } from './wdio-executor.js';

/** The current-test bookkeeping kept between `beforeTest` and `afterTest`. */
interface CurrentTest {
  title: string;
  spec?: string;
}

/** Minimal capability shape we read for the report header (browser name/version). */
interface BrowserCapabilities {
  browserName?: string;
  browserVersion?: string;
  version?: string;
}

/** The browser fields the session reads beyond the BrowserExecutor surface. */
type SessionBrowser = WdioBrowser & {
  capabilities?: BrowserCapabilities;
  sessionId?: string;
};

export class TraceLaneSession {
  private readonly options: TraceLaneOptions;
  private readonly outDir: string;
  private readonly captureRrweb: boolean;
  private readonly captureNetwork: boolean;
  private readonly captureConsole: boolean;
  private framework: Framework | string | undefined;
  private cid: string | undefined;

  private browser: SessionBrowser | undefined;
  private recorder: Recorder | undefined;
  private current: CurrentTest | undefined;
  private networkAttached = false;
  /** Set once CDP attach has failed, to stop the per-test retry storm (#2). */
  private networkUnavailable = false;

  constructor(options: TraceLaneOptions = {}, framework?: string, cid?: string) {
    this.options = options;
    this.outDir = options.outDir ?? DEFAULT_OUT_DIR;
    // Capture channels default on (P1 PRD §M.1).
    this.captureRrweb = options.capture?.rrweb !== false;
    this.captureNetwork = options.capture?.network !== false;
    this.captureConsole = options.capture?.console !== false;
    this.framework = framework;
    this.cid = cid;
  }

  /** Tell the session which framework is running (from `beforeSession`/config). */
  setFramework(framework: string | undefined): void {
    if (framework) this.framework = framework;
  }

  /** Tell the session its worker capability id (for parallel-safe filenames). */
  setCid(cid: string | undefined): void {
    if (cid) this.cid = cid;
  }

  /**
   * `before` hook: stash the live browser. The recorder is created lazily
   * per-test in `onBeforeTest` (not here), so no recorder lingers between tests
   * and worker teardown never drains an unstarted recorder (#5).
   */
  async onBefore(browser: SessionBrowser): Promise<void> {
    this.browser = browser;
  }

  /**
   * Resolve the console-plugin options: when `capture.console === false`, pass
   * `{ level: [] }` so the rrweb console plugin patches no `console.*` methods
   * and installs no error/rejection listeners — i.e. console capture is off
   * (#1). Otherwise forward any user-supplied `consolePluginOptions` (the core
   * recorder applies its defaults when none are given).
   */
  private resolveConsolePluginOptions(): ConsolePluginOptions | undefined {
    if (!this.captureConsole) return { level: [] };
    return this.options.consolePluginOptions;
  }

  /** Build a fresh recorder for the live browser (one per test; #5). */
  private createRecorderForCurrentTest(browser: SessionBrowser): Recorder {
    const recorderOptions: Parameters<typeof createRecorder>[0] = {
      executor: createWdioExecutor(browser),
      rrwebBundle: loadRrwebBundle(),
    };
    if (this.options.drainIntervalMs !== undefined) {
      recorderOptions.drainIntervalMs = this.options.drainIntervalMs;
    }
    if (this.options.cooldownMs !== undefined) {
      recorderOptions.cooldownMs = this.options.cooldownMs;
    }
    const consolePluginOptions = this.resolveConsolePluginOptions();
    if (consolePluginOptions !== undefined) {
      recorderOptions.consolePluginOptions = consolePluginOptions;
    }
    if (this.options.mode !== undefined) {
      recorderOptions.mode = this.options.mode as Mode;
    }
    return createRecorder(recorderOptions);
  }

  /** `beforeTest`/`beforeScenario`: record the test identity and start capture. */
  async onBeforeTest(title: string, spec?: string): Promise<void> {
    this.current = spec ? { title, spec } : { title };
    if (!this.captureRrweb || !this.browser) return;
    // Create + start a fresh recorder for this test (#5). A passing test in
    // `failed` mode discards its buffer at finalize; no recorder survives the
    // test, so teardown never re-drains.
    this.recorder = this.createRecorderForCurrentTest(this.browser);
    await this.recorder.start();
    await this.maybeAttachNetworkCapture();
  }

  /**
   * Attach CDP network capture once per session. After the first failure (no
   * devtools-service / non-Chrome / Selenium Grid), set a sentinel so every
   * subsequent test skips the attempt instead of retrying forever, and warn
   * exactly once (#2).
   */
  private async maybeAttachNetworkCapture(): Promise<void> {
    if (!this.captureNetwork || this.networkAttached || this.networkUnavailable) return;
    if (!this.browser) return;
    try {
      await attachNetworkCapture(createWdioExecutor(this.browser));
      this.networkAttached = true;
    } catch {
      // Give up for the rest of the session and say so once.
      this.networkUnavailable = true;
      console.warn(
        '[tracelane/wdio] network capture unavailable (CDP not attached); degrading to rrweb+console only.',
      );
    }
  }

  /** WDIO `beforeCommand('url', ...)`: re-inject the recorder after navigation. */
  async onUrl(url: string): Promise<void> {
    if (!this.recorder) return;
    await this.recorder.reinject(url);
  }

  /**
   * `afterTest`/`afterScenario`: normalize the framework result, ask the
   * recorder for the report decision (ADR-0005), and write the HTML on a build.
   * Returns the path written, or undefined when no report was produced. Drops
   * the recorder afterward so the next test starts fresh and teardown has
   * nothing to drain (#5).
   */
  async onAfterTest(resultA: unknown, resultB?: unknown): Promise<string | undefined> {
    const normalized = normalizeResult(this.framework, resultA, resultB);
    const recorder = this.recorder;
    this.recorder = undefined;
    if (!recorder) {
      this.current = undefined;
      return undefined;
    }
    const { shouldBuildReport, events } = await recorder.finalize({
      passed: normalized.passed,
    });

    if (!shouldBuildReport) {
      this.current = undefined;
      return undefined;
    }

    const meta = this.buildMeta(normalized);
    const path = writeReport({ outDir: this.outDir, cid: this.cid, events, meta });
    this.current = undefined;
    return path;
  }

  /**
   * `afterSuite`/`after`: stop the active recorder so no poll timer leaks past
   * the worker. In the normal flow `onAfterTest` already finalized + dropped the
   * recorder, so this is a no-op; it only fires if a test started but never
   * reached `afterTest` (#5 — never drains an unstarted recorder).
   */
  async onAfter(): Promise<void> {
    if (this.recorder) {
      await this.recorder.stop();
      this.recorder = undefined;
    }
  }

  /** Compose the report metadata from the current test + browser capabilities. */
  private buildMeta(normalized: ReturnType<typeof normalizeResult>): ReportMeta {
    const caps = this.browser?.capabilities;
    const meta: ReportMeta = {
      title: this.current?.title ?? 'unknown test',
      status: normalized.status,
    };
    if (this.current?.spec) meta.spec = this.current.spec;
    if (normalized.error !== undefined) meta.error = normalized.error;
    if (normalized.durationMs !== undefined) meta.durationMs = normalized.durationMs;
    if (caps?.browserName) meta.browserName = caps.browserName;
    const browserVersion = caps?.browserVersion ?? caps?.version;
    if (browserVersion) meta.browserVersion = browserVersion;
    return meta;
  }
}
