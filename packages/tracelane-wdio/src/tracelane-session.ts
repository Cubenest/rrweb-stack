// The shared per-worker capture session.
//
// Both surfaces — the `TraceLaneService` class (Task 2.14) and the
// `traceLaneHooks` factory (Task 2.15) — delegate to one `TraceLaneSession` so
// the capture/inject/drain/report logic lives in exactly one place (ADR-0004:
// "the same logic exported as plain hook functions"). The session owns the
// recorder, the current-test metadata, and the report-write decision.

import { type Mode, type Recorder, createRecorder } from '@tracelane/core';
import type { ReportMeta } from '@tracelane/report';
import { type Framework, normalizeResult } from './framework-result';
import { loadRrwebBundle } from './inpage-bundle';
import { attachNetworkCapture } from './network-capture';
import { DEFAULT_OUT_DIR, type TraceLaneOptions } from './options';
import { writeReport } from './report-writer';
import { type WdioBrowser, createWdioExecutor } from './wdio-executor';

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
  private framework: Framework | string | undefined;
  private cid: string | undefined;

  private browser: SessionBrowser | undefined;
  private recorder: Recorder | undefined;
  private current: CurrentTest | undefined;
  private networkAttached = false;

  constructor(options: TraceLaneOptions = {}, framework?: string, cid?: string) {
    this.options = options;
    this.outDir = options.outDir ?? DEFAULT_OUT_DIR;
    // Capture channels default on (P1 PRD §M.1).
    this.captureRrweb = options.capture?.rrweb !== false;
    this.captureNetwork = options.capture?.network !== false;
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
   * `before` hook: stash the live browser and build the recorder. The recorder
   * isn't started here — capture begins per test in `beforeTest` so passing
   * tests in `failed` mode never pay the injection cost beyond a single test.
   */
  async onBefore(browser: SessionBrowser): Promise<void> {
    this.browser = browser;
    if (!this.captureRrweb) return;
    const executor = createWdioExecutor(browser);
    const recorderOptions: Parameters<typeof createRecorder>[0] = {
      executor,
      rrwebBundle: loadRrwebBundle(),
    };
    if (this.options.drainIntervalMs !== undefined) {
      recorderOptions.drainIntervalMs = this.options.drainIntervalMs;
    }
    if (this.options.cooldownMs !== undefined) {
      recorderOptions.cooldownMs = this.options.cooldownMs;
    }
    if (this.options.consolePluginOptions !== undefined) {
      recorderOptions.consolePluginOptions = this.options.consolePluginOptions;
    }
    if (this.options.mode !== undefined) {
      recorderOptions.mode = this.options.mode as Mode;
    }
    this.recorder = createRecorder(recorderOptions);
  }

  /** `beforeTest`/`beforeScenario`: record the test identity and start capture. */
  async onBeforeTest(title: string, spec?: string): Promise<void> {
    this.current = spec ? { title, spec } : { title };
    if (!this.recorder || !this.browser) return;
    await this.recorder.start();
    // Attach CDP network capture once per session (the CDP connection and the
    // page console outlive individual tests).
    if (this.captureNetwork && !this.networkAttached) {
      this.networkAttached = true;
      try {
        await attachNetworkCapture(createWdioExecutor(this.browser));
      } catch {
        // CDP unavailable (no devtools-service / non-Chrome): degrade to
        // rrweb-only capture rather than failing the test.
        this.networkAttached = false;
      }
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
   * Returns the path written, or undefined when no report was produced.
   */
  async onAfterTest(resultA: unknown, resultB?: unknown): Promise<string | undefined> {
    const normalized = normalizeResult(this.framework, resultA, resultB);
    if (!this.recorder) {
      this.current = undefined;
      return undefined;
    }
    const { shouldBuildReport, events } = await this.recorder.finalize({
      passed: normalized.passed,
    });
    // Rebuild a fresh recorder so the next test starts with an empty buffer.
    this.recorder = undefined;
    const browser = this.browser;
    if (browser) await this.onBefore(browser);

    if (!shouldBuildReport) {
      this.current = undefined;
      return undefined;
    }

    const meta = this.buildMeta(normalized);
    const path = writeReport({ outDir: this.outDir, cid: this.cid, events, meta });
    this.current = undefined;
    return path;
  }

  /** `afterSuite`/`after`: stop polling so no timer leaks past the worker. */
  async onAfter(): Promise<void> {
    if (this.recorder) await this.recorder.stop();
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
