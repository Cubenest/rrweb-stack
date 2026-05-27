// get_session_summary (PRD §B3): a compact, LLM-readable narrative of a
// session — pages visited, click/input counts, error counts, key URLs. Combines
// the structured SQL rows (fast) with a pass over the event stream for the
// interaction tallies. Kept well under the ~2K-token budget by counting rather
// than listing.

import type { Database } from 'better-sqlite3';
import { extractUserActions } from './event-walker.js';
import { type SessionSummaryRow, getConsoleErrors, getNetworkErrors } from './queries.js';
import type { eventWithTime } from './rrweb-types.js';

export interface SessionSummary {
  readonly id: string;
  readonly origin: string | null;
  readonly title: string | null;
  readonly startedAt: number;
  readonly durationMs: number;
  readonly pagesVisited: string[];
  readonly clicks: number;
  readonly inputs: number;
  readonly navigations: number;
  readonly consoleErrorCount: number;
  readonly networkErrorCount: number;
  /** A one-paragraph natural-language narrative for the model. */
  readonly narrative: string;
}

const MAX_PAGES = 20;

/**
 * Build the session summary from its metadata row + decoded event stream. The
 * caller supplies `events` (already decompressed via the blob loader) so this
 * stays pure / testable; pass `[]` when the blob is missing and the summary
 * falls back to metadata + SQL counts only.
 */
export function buildSessionSummary(
  db: Database,
  row: SessionSummaryRow,
  events: eventWithTime[],
): SessionSummary {
  const actions = extractUserActions(events);
  const clicks = actions.filter((a) => a.type === 'click').length;
  const inputs = actions.filter((a) => a.type === 'input').length;
  const navActions = actions.filter((a) => a.type === 'navigate');

  // Pages visited: the initial URL + every navigation target, de-duped, capped.
  const pages: string[] = [];
  const seen = new Set<string>();
  const pushPage = (u: string | null | undefined): void => {
    if (!u || seen.has(u) || pages.length >= MAX_PAGES) return;
    seen.add(u);
    pages.push(u);
  };
  pushPage(row.url);
  for (const nav of navActions) pushPage(nav.url);

  const consoleErrorCount = getConsoleErrors(db, row.id, { limit: 1000 }).length;
  const networkErrorCount = getNetworkErrors(db, row.id, { limit: 1000 }).length;

  const durationSec = Math.round(row.durationMs / 1000);
  const titlePart = row.title ? ` ("${row.title}")` : '';
  const originPart = row.origin ? ` on ${row.origin}` : '';
  const acrossPart = navActions.length > 0 ? `, across ${navActions.length} navigation(s)` : '';
  const errorsSentence =
    consoleErrorCount > 0 || networkErrorCount > 0
      ? ` Recorded ${consoleErrorCount} console error(s) and ${networkErrorCount} network error(s).`
      : ' No console or network errors were recorded.';
  const visited = `The user visited ${pages.length} page(s), made ${clicks} click(s) and ${inputs} input(s)${acrossPart}.`;
  const narrative = `Session ${row.id}${titlePart}${originPart} lasted ~${durationSec}s. ${visited}${errorsSentence}`;

  return {
    id: row.id,
    origin: row.origin,
    title: row.title,
    startedAt: row.startedAt,
    durationMs: row.durationMs,
    pagesVisited: pages,
    clicks,
    inputs,
    navigations: navActions.length,
    consoleErrorCount,
    networkErrorCount,
    narrative,
  };
}
