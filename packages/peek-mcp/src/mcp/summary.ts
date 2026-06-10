// get_session_summary (PRD §B3): a compact, LLM-readable narrative of a
// session — pages visited, click/input counts, error counts, key URLs. Combines
// the structured SQL rows (fast) with a pass over the event stream for the
// interaction tallies. Kept well under the ~2K-token budget by counting rather
// than listing.

import type { Database } from 'better-sqlite3';
import { extractUserActions } from './event-walker.js';
import { type SessionSummaryRow, countConsoleErrors, countNetworkErrors } from './queries.js';
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
  /**
   * Whether this session has DOM/replay events. False means get_dom_snapshot
   * and generate_playwright_repro are unavailable.
   */
  readonly hasReplay: boolean;
  /** The raw event_count from the sessions table (0 when no blob was captured). */
  readonly eventCount: number;
  /** A one-paragraph natural-language narrative for the model. */
  readonly narrative: string;
}

const MAX_PAGES = 20;
/** Max chars for free-text page metadata embedded in the summary (budget guard). */
const MAX_TITLE = 200;
const MAX_ORIGIN = 100;
const MAX_URL = 300;

/** Truncate a string for token-budget safety, marking the cut; null passes through. */
function clip(s: string | null, max: number): string | null {
  if (s === null) return null;
  return s.length <= max ? s : `${s.slice(0, max)}… [+${s.length - max} chars]`;
}

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

  // Pages visited: the initial URL + every navigation target, de-duped, capped
  // (each clipped so a pathological URL can't blow the budget).
  const pages: string[] = [];
  const seen = new Set<string>();
  const pushPage = (u: string | null | undefined): void => {
    if (!u || seen.has(u) || pages.length >= MAX_PAGES) return;
    seen.add(u);
    pages.push(clip(u, MAX_URL) as string);
  };
  pushPage(row.url);
  for (const nav of navActions) pushPage(nav.url);

  // Accurate COUNT(*) — not a capped re-fetch — so a session with >1000 errors
  // reports the true total in the primary narrative.
  const consoleErrorCount = countConsoleErrors(db, row.id);
  const networkErrorCount = countNetworkErrors(db, row.id);

  // Clip free-text page metadata for budget consistency with the other tools.
  const title = clip(row.title, MAX_TITLE);
  const origin = clip(row.origin, MAX_ORIGIN);

  const hasReplay = events.length > 0;

  const durationSec = Math.round(row.durationMs / 1000);
  const titlePart = title ? ` ("${title}")` : '';
  const originPart = origin ? ` on ${origin}` : '';
  const acrossPart = navActions.length > 0 ? `, across ${navActions.length} navigation(s)` : '';
  const errorsSentence =
    consoleErrorCount > 0 || networkErrorCount > 0
      ? ` Recorded ${consoleErrorCount} console error(s) and ${networkErrorCount} network error(s).`
      : ' No console or network errors were recorded.';
  const visited = `The user visited ${pages.length} page(s), made ${clicks} click(s) and ${inputs} input(s)${acrossPart}.`;
  const noReplayWarning = !hasReplay
    ? ` ⚠️ No DOM/replay events were captured for this session (event_count ${row.eventCount}); get_dom_snapshot and generate_playwright_repro are unavailable. This commonly happens when Deep capture (chrome.debugger) was attached, which currently suppresses rrweb capture — network/console rows may still be present.`
    : '';
  const narrative = `Session ${row.id}${titlePart}${originPart} lasted ~${durationSec}s. ${visited}${errorsSentence}${noReplayWarning}`;

  return {
    id: row.id,
    origin,
    title,
    startedAt: row.startedAt,
    durationMs: row.durationMs,
    pagesVisited: pages,
    clicks,
    inputs,
    navigations: navActions.length,
    consoleErrorCount,
    networkErrorCount,
    hasReplay,
    eventCount: row.eventCount,
    narrative,
  };
}
