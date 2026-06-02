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

import type { Page, TestInfo } from '@playwright/test';
import { type Recorder, createRecorder } from '@tracelane/core';
import { type ReportMeta, writeReport } from '@tracelane/report';
import type { ResolvedOptions } from './options.js';
import { createPlaywrightExecutor } from './playwright-executor.js';
import { isPassed, mapStatus } from './result-status.js';

/** Inputs to start a capture session. */
export interface StartInput {
  page: Page;
  options: ResolvedOptions;
  rrwebBundle: string;
}

/** The live handles a started session carries across the use() boundary. */
export interface StartedSession {
  recorder: Recorder;
}

/** Inputs to finalize a session (report build/write). */
export interface FinalizeInput {
  page: Page;
  testInfo: TestInfo;
  options: ResolvedOptions;
  rrwebBundle: string;
}

/** Inject the rrweb bundle on the context, build the executor, start the recorder. */
export async function runStart(input: StartInput): Promise<StartedSession> {
  const { page, options, rrwebBundle } = input;
  // Inject on the context so newly-created / navigated documents get rrweb
  // before any app script runs.
  await page.context().addInitScript({ content: rrwebBundle });
  const executor = createPlaywrightExecutor(page);
  const recorder = createRecorder({
    executor,
    rrwebBundle,
    mode: options.mode,
    // MVP: in-page network plugin off (captureNetwork drives the CDP path in
    // Task 9); the recorder still captures rrweb + console.
  });
  await recorder.start();
  return { recorder };
}

/** Compose the report metadata from Playwright's testInfo. */
function buildMeta(testInfo: TestInfo): ReportMeta {
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
  return meta;
}

/** Finalize the recorder (apply mode policy), and write a report when one is due. */
export async function runFinalize(session: StartedSession, input: FinalizeInput): Promise<void> {
  const { testInfo, options } = input;
  const { shouldBuildReport, events } = await session.recorder.finalize({
    passed: isPassed(testInfo),
  });
  if (!shouldBuildReport) return;
  writeReport({
    outDir: options.outDir,
    // project.name namespaces the filename so parallel projects/workers never
    // collide (ADR-0006 action item #6).
    cid: testInfo.project?.name,
    events,
    meta: buildMeta(testInfo),
  });
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
