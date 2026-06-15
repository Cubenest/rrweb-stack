// Per-test capture orchestration (P1 PRD §B.2). This is the only place with a
// live `page` + `testInfo`, so it owns the recorder lifecycle and the report
// build. It is split into runStart (inject bundle + start recorder) and
// runFinalize (finalize + write report) so the auto-fixture (Task 10) can
// straddle the `use()` boundary: start before the test body runs, finalize
// after. runTracelaneSession is a start→finalize convenience used in tests.
//
// rrweb is injected two ways: via context.addInitScript (so fresh pages /
// post-navigation documents get the bundle automatically) and via the
// recorder's own start() (which evals the bundle + installs the in-page buffer
// in the CURRENT document). The recorder then drains events Node-side on its
// poll loop and at finalize (ADR-0006).

import { cwd } from 'node:process';
import type { CDPSession, Frame, Page, TestInfo } from '@playwright/test';
import {
  type ConsolePluginOptions,
  type Recorder,
  attachNetworkCapture,
  createRecorder,
} from '@tracelane/core';
import { type ReportMeta, writeReport } from '@tracelane/report';
import type { ResolvedOptions } from './options.js';
import { createPlaywrightExecutor } from './playwright-executor.js';
import { isPassed, mapStatus } from './result-status.js';
import { loadSecuritySuppressions } from './security-suppress.js';

/** Inputs to start a capture session. */
export interface StartInput {
  page: Page;
  options: ResolvedOptions;
  rrwebBundle: string;
}

/** The live handles a started session carries across the use() boundary. */
export interface StartedSession {
  recorder: Recorder;
  /** The Chromium CDP session, when network capture was attached (else undefined). */
  cdp?: CDPSession;
  /** Browser name (e.g. `chromium`) for the report header, when resolvable. */
  browserName?: string;
  /** Browser version for the report header, when resolvable. */
  browserVersion?: string;
  /** The page we attached the navigation listener to (for removal at finalize). */
  page?: Page;
  /** The framenavigated handler, removed in runFinalize to avoid cross-test leaks. */
  onNav?: (frame: Frame) => void;
  /** Set when capture could not start (e.g. CSP); runFinalize writes nothing. */
  disabled?: boolean;
}

/** The Playwright browser-type name, when resolvable from the page's context. */
function browserNameOf(page: Page): string | undefined {
  try {
    return page.context().browser()?.browserType().name();
  } catch {
    return undefined;
  }
}

/** Inputs to finalize a session (report build/write). */
export interface FinalizeInput {
  page: Page;
  testInfo: TestInfo;
  options: ResolvedOptions;
  rrwebBundle: string;
}

/**
 * Resolve the console-plugin options: when `captureConsole` is false, pass
 * `{ level: [] }` so the rrweb console plugin patches no `console.*` methods
 * and installs no error/rejection listeners — i.e. console capture is off
 * (mirrors @tracelane/wdio). Otherwise forward any user-supplied
 * `consolePluginOptions` (the core recorder applies its defaults when none are
 * given, so `undefined` is returned to keep that behavior).
 */
function resolveConsolePluginOptions(options: ResolvedOptions): ConsolePluginOptions | undefined {
  if (options.captureConsole === false) return { level: [] };
  return options.consolePluginOptions;
}

/** Inject the rrweb bundle on the context, build the executor, start the recorder. */
export async function runStart(input: StartInput): Promise<StartedSession> {
  const { page, options, rrwebBundle } = input;

  // rrweb opt-out: when capture.rrweb is false, no recorder starts and no
  // report is written (mirrors @tracelane/wdio `capture.rrweb:false`). We skip
  // the context injection + CDP entirely. The returned session is disabled, so
  // runFinalize writes nothing. Default-on: only an explicit `false` disables.
  if (options.captureRrweb === false) {
    return { recorder: undefined as unknown as Recorder, disabled: true };
  }

  const context = page.context();
  // Inject on the context so newly-created / navigated documents get rrweb
  // before any app script runs.
  await context.addInitScript({ content: rrwebBundle });

  const browserName = browserNameOf(page);
  let browserVersion: string | undefined;
  try {
    browserVersion = context.browser()?.version();
  } catch {
    browserVersion = undefined;
  }

  // CDP network capture is Chromium-only (P1 PRD §E.2). Open CDP only when opted
  // in and on Chromium; on Firefox/WebKit (no CDP) we silently degrade to rrweb +
  // console. A failure opening CDP here also degrades to rrweb+console only.
  let cdp: CDPSession | undefined;
  if (options.captureNetwork && browserName === 'chromium') {
    try {
      cdp = await context.newCDPSession(page);
    } catch {
      cdp = undefined; // no CDP; rrweb+console still work
      console.warn(
        '[tracelane] could not open a CDP session; CDP network enrichment unavailable, continuing with in-page rrweb network capture.',
      );
    }
  }

  // ONE executor for both network capture and the recorder (recorder uses only
  // execute(); cdp/on are used solely by attachNetworkCapture).
  const executor = createPlaywrightExecutor(page, cdp);

  const recorderOptions: Parameters<typeof createRecorder>[0] = {
    executor,
    rrwebBundle,
    mode: options.mode,
  };
  // Drain/cooldown tuning (ADR-0006): forward only when set, else the core
  // recorder applies its defaults.
  if (options.drainIntervalMs !== undefined) {
    recorderOptions.drainIntervalMs = options.drainIntervalMs;
  }
  if (options.cooldownMs !== undefined) {
    recorderOptions.cooldownMs = options.cooldownMs;
  }
  // Console capture: `{ level: [] }` disables it; otherwise the user's options
  // (or undefined → core defaults).
  const consolePluginOptions = resolveConsolePluginOptions(options);
  if (consolePluginOptions !== undefined) {
    recorderOptions.consolePluginOptions = consolePluginOptions;
  }
  // In-page rrweb network plugin (`rrweb/network@1`): the framework-agnostic
  // network channel that works on ALL browsers (Chromium/Firefox/WebKit) with
  // no CDP — it wraps fetch/XHR + reads PerformanceObserver from inside the
  // page. Privacy-first defaults (`{}`): URL/method/status/timing only, headers
  // + bodies off. On Chromium the CDP path above ALSO runs and enriches these
  // rows with authoritative status + true no-response failures; the report
  // merges the two (real status wins). Mirrors @tracelane/wdio. Off entirely
  // when `captureNetwork` is false.
  if (options.captureNetwork) {
    recorderOptions.networkPluginOptions =
      (options.networkOptions as Record<string, unknown> | undefined) ?? {};
  }
  const recorder = createRecorder(recorderOptions);

  // Network capture is best-effort: if it fails, detach CDP and continue.
  if (cdp) {
    try {
      await attachNetworkCapture(executor, {
        security: options.security,
        onSecurityMeta: (m) => recorder.addCustomEvent('tracelane.sec', m),
      });
    } catch {
      await cdp.detach().catch(() => {});
      cdp = undefined;
      console.warn(
        '[tracelane] CDP network enrichment unavailable; continuing with in-page rrweb network capture.',
      );
    }
  }

  // Capture start is best-effort: a CSP / injection failure must NOT fail the
  // user's test. Degrade to a disabled session that writes no report.
  try {
    await recorder.start();
  } catch (err) {
    if (cdp) await cdp.detach().catch(() => {});
    console.warn(
      '[tracelane] capture unavailable on this page (likely a Content-Security-Policy blocking ' +
        "script evaluation; rrweb needs 'unsafe-eval'). The test runs normally; no replay was recorded.",
      err,
    );
    return { recorder, disabled: true };
  }

  const onNav = (frame: Frame): void => {
    if (frame !== page.mainFrame()) return; // main frame only; ignore sub-frames
    // Fire-and-forget: navigation may tear the page down; the recorder's
    // cooldown + monotonic session id dedupe hash/HMR re-renders.
    void recorder.reinject(frame.url()).catch(() => {
      /* best-effort; page may be gone */
    });
  };
  page.on('framenavigated', onNav);

  const session: StartedSession = { recorder, page, onNav };
  if (cdp) session.cdp = cdp;
  if (browserName !== undefined) session.browserName = browserName;
  if (browserVersion !== undefined) session.browserVersion = browserVersion;
  return session;
}

/** Compose the report metadata from Playwright's testInfo + resolved browser info. */
function buildMeta(testInfo: TestInfo, session: StartedSession): ReportMeta {
  // TestInfo.titlePath is an Array<string> property (NOT a method) — it is the
  // [project, file, ...describe titles, test title] chain. Join it for a
  // human-readable report title.
  const meta: ReportMeta = {
    title: testInfo.titlePath.join(' › '),
    status: mapStatus((testInfo.status ?? 'failed') as never),
  };
  if (testInfo.file) meta.spec = testInfo.file;
  const error = testInfo.error?.stack ?? testInfo.error?.message;
  if (error !== undefined) meta.error = error;
  if (typeof testInfo.duration === 'number') meta.durationMs = testInfo.duration;
  if (session.browserName !== undefined) meta.browserName = session.browserName;
  if (session.browserVersion !== undefined) meta.browserVersion = session.browserVersion;
  return meta;
}

/** Finalize the recorder (apply mode policy), and write a report when one is due. */
export async function runFinalize(session: StartedSession, input: FinalizeInput): Promise<void> {
  if (session.disabled) return; // capture never started; nothing to finalize/clean up
  // Unsubscribe the navigation listener BEFORE the first await: finalize() returns
  // the live event buffer, so a late main-frame navigation during teardown could
  // reinject and leak a stray tracelane.nav event into the report being written.
  if (session.page && session.onNav) {
    session.page.off('framenavigated', session.onNav);
  }
  const { testInfo, options } = input;
  try {
    const { shouldBuildReport, events } = await session.recorder.finalize({
      passed: isPassed(testInfo),
    });
    if (!shouldBuildReport) return;
    // Load the optional suppression file at report-write time. The loader never
    // throws and falls back to `[]`, so a missing/malformed file can't break the
    // report. Skip the read entirely when security is off.
    const securitySuppress = options.security ? loadSecuritySuppressions(cwd()) : [];
    writeReport({
      outDir: options.outDir,
      // project.name namespaces the filename so parallel projects/workers never
      // collide (ADR-0006 action item #6).
      cid: testInfo.project?.name,
      events,
      meta: buildMeta(testInfo, session),
      footer: options.footer,
      security: options.security,
      securitySuppress,
    });
  } finally {
    // Always detach the CDP session so it doesn't leak past the test.
    if (session.cdp) {
      await session.cdp.detach().catch(() => {
        /* page/context may already be closed */
      });
    }
  }
}

/** Convenience: start a session, then immediately finalize it (start→finalize). */
export async function runTracelaneSession(
  input: FinalizeInput & { rrwebBundle: string },
): Promise<void> {
  const session = await runStart({
    page: input.page,
    options: input.options,
    rrwebBundle: input.rrwebBundle,
  });
  await runFinalize(session, input);
}
