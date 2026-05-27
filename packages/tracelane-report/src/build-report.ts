// buildReport — the package entry point.
//
// Given a captured rrweb event stream + test metadata, produce a single,
// self-contained, offline HTML report string (P1 PRD §F). Orchestration only;
// each concern lives in its own module:
//   • size-budget prune ............ @tracelane/core (pruneToSizeBudget)
//   • events → gzip → base64 ....... embed.ts        (Task 2.9)
//   • console / network extraction . panels.ts       (Task 2.10)
//   • CI metadata + header ......... metadata.ts     (Task 2.11)
//   • copy-as-markdown payload ..... markdown.ts     (Task 2.12)
//   • HTML composition ............. template.ts
//
// The size guard reuses @tracelane/core's pruneToSizeBudget so the report never
// exceeds the 25 MB budget (ADR-0005); the report renders a banner when a prune
// fired so the truncation is visible to the user.

import type { eventWithTime } from '@cubenest/rrweb-core';
import { pruneToSizeBudget } from '@tracelane/core';
import { encodeEventsBlob } from './embed';
import { buildMarkdown, extractActionLog } from './markdown';
import { resolveCiMetadata } from './metadata';
import { extractConsole, extractNetwork } from './panels';
import { renderReportHtml } from './template';
import type { ReportMeta } from './types';

/** Options for {@link buildReport}. */
export interface BuildReportOptions {
  /**
   * Prune events to the 25 MB budget before embedding (ADR-0005). Default true.
   * Pass `false` only when the caller has already applied the size guard.
   */
  enforceSizeBudget?: boolean;
}

/**
 * Build a self-contained HTML report for one test run.
 *
 * @param events  the captured rrweb event stream (chronological)
 * @param meta    test metadata; CI provenance is auto-filled from the env
 * @returns a complete `.html` document string — write it to disk as-is
 */
export function buildReport(
  events: eventWithTime[],
  meta: ReportMeta,
  options: BuildReportOptions = {},
): string {
  const { enforceSizeBudget = true } = options;

  // Keep the report within budget; surface a banner if anything was dropped.
  const { events: sized, pruned } = enforceSizeBudget
    ? pruneToSizeBudget(events)
    : { events, pruned: false };

  const resolvedMeta = resolveCiMetadata(meta);
  const consoleRows = extractConsole(sized);
  const networkRows = extractNetwork(sized);
  const actions = extractActionLog(sized);
  const markdown = buildMarkdown(resolvedMeta, consoleRows, networkRows, actions);

  return renderReportHtml({
    meta: resolvedMeta,
    eventsGzB64: encodeEventsBlob(sized),
    console: consoleRows,
    network: networkRows,
    markdown,
    pruned,
  });
}
