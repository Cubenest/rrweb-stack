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
import { analyze } from '@tracelane/security';
import type { SecurityFinding, Suppression } from '@tracelane/security';
import { encodeEventsBlob } from './embed.js';
import { buildMarkdown, extractActionLog } from './markdown.js';
import { resolveCiMetadata } from './metadata.js';
import { extractConsole, extractNetwork } from './panels.js';
import { renderReportHtml } from './template.js';
import type { ReportMeta } from './types.js';

/** Options for {@link buildReport}. */
export interface BuildReportOptions {
  /**
   * Prune events to the 25 MB budget before embedding (ADR-0005). Default true.
   * Pass `false` only when the caller has already applied the size guard.
   */
  enforceSizeBudget?: boolean;
  /**
   * Render the self-marketing footer in the report. Default true. Pass `false`
   * to suppress it (surfaces the wdio `report: { footer: false }` opt-out —
   * audit A-8).
   */
  footer?: boolean;
  /**
   * Run the advisory `@tracelane/security` analyzer over the captured stream
   * and surface its findings in the report (Markdown section + collapsed
   * panel). Default true. Pass `false` to skip analysis entirely — `analyze`
   * is not called and nothing security-related is rendered.
   */
  security?: boolean;
  /**
   * Suppressions forwarded to the analyzer (e.g. silence a known-acceptable
   * signal/url). Ignored when `security` is `false`.
   */
  securitySuppress?: Suppression[];
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
  const {
    enforceSizeBudget = true,
    footer = true,
    security = true,
    securitySuppress = [],
  } = options;

  // Keep the report within budget; surface a banner if anything was dropped.
  const { events: sized, pruned } = enforceSizeBudget
    ? pruneToSizeBudget(events)
    : { events, pruned: false };

  const resolvedMeta = resolveCiMetadata(meta);
  const consoleRows = extractConsole(sized);
  const networkRows = extractNetwork(sized);
  const actions = extractActionLog(sized);
  // Advisory security-hygiene analysis (default on). Runs over the SAME
  // size-pruned events the other extractors consume; skipped when disabled.
  const securityFindings: SecurityFinding[] = security
    ? analyze(sized, { suppress: securitySuppress })
    : [];
  const markdown = buildMarkdown(resolvedMeta, consoleRows, networkRows, actions, securityFindings);

  // First/last event timestamps drive the hero meta strip's "Events" item,
  // the replay-header session-range label, and the failure marker on the
  // custom timeline strip. `?? 0` fallback covers the crashed-before-
  // recorder-snapshot path (sized empty) — optional chaining + nullish
  // coalescing keep the type-safety without a non-null assertion.
  const firstTs = sized[0]?.timestamp ?? 0;
  const lastTs = sized[sized.length - 1]?.timestamp ?? 0;

  return renderReportHtml({
    meta: resolvedMeta,
    eventsGzB64: encodeEventsBlob(sized),
    console: consoleRows,
    network: networkRows,
    security: securityFindings,
    markdown,
    pruned,
    eventCount: sized.length,
    firstTs,
    lastTs,
    footer,
  });
}
