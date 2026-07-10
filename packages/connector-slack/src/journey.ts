/**
 * journey.ts — CausalChain → Slack canvas markdown + Block Kit fallback.
 *
 * Types are defined locally so this package does not take a runtime dependency
 * on @peekdev/mcp. The shape mirrors `CausalChain` / `TimelineEntry` from
 * packages/peek-mcp/src/mcp/causal-chain.ts exactly — kept in sync manually.
 */
import type { KnownBlock } from '@slack/types';

// ---------------------------------------------------------------------------
// Local CausalChain shape (mirrors peek-mcp; no runtime dep on that package)
// ---------------------------------------------------------------------------

export interface JourneyTimelineEntry {
  readonly ts: number;
  readonly relMs: number;
  readonly kind: 'action' | 'dom' | 'network' | 'error';
  readonly summary: string;
  readonly ref?: number;
}

export interface JourneyError {
  readonly id: number;
  readonly ts: number;
  readonly level: string;
  readonly message: string;
  readonly stack?: string;
}

export interface JourneyNetworkError {
  readonly ts: number;
  readonly method: string;
  readonly url: string;
  // Producer (peek-mcp) emits `number | null` — a net-level failure with no
  // HTTP status serializes as JSON `null`, not absent. Accept both.
  readonly status?: number | null;
  readonly errorText?: string;
}

export interface JourneyCausalChain {
  readonly errorId: number;
  readonly errorTs: number;
  readonly error: JourneyError;
  readonly windowMs: number;
  readonly timeline: JourneyTimelineEntry[];
  readonly narrative: string;
  readonly networkErrors: JourneyNetworkError[];
  readonly truncated: { readonly domMutations?: boolean; readonly networkErrors?: boolean };
}

// ---------------------------------------------------------------------------
// Canvas markdown limits
// ---------------------------------------------------------------------------

/** Maximum timeline entries to render inline before we truncate. Keeps the
 *  canvas markdown well under Slack's `canvas_too_large` limit (≈1 MB). */
const MAX_TIMELINE_ENTRIES = 200;

/** Maximum rows per table (header + rows); Slack canvas hard-caps at 300 cells. */
const MAX_TABLE_ROWS = 25; // 25 rows × 3 cols = 75 cells per table, leaves plenty of margin

/** Slack Block Kit hard limit on the number of blocks in a message. */
export const SLACK_BLOCK_LIMIT = 50;

// ---------------------------------------------------------------------------
// Per-kind emoji
// ---------------------------------------------------------------------------

function kindEmoji(kind: JourneyTimelineEntry['kind'], summary: string): string {
  switch (kind) {
    case 'error':
      return '⚠';
    case 'network':
      return '🌐';
    case 'dom':
      return '🔲';
    case 'action': {
      // Best-effort input detection from summary text (masking hides value)
      const lower = summary.toLowerCase();
      if (lower.startsWith('type ') || lower.startsWith('fill ')) return '⌨';
      if (lower.startsWith('navigate ') || lower.startsWith('go to ')) return '🧭';
      return '🖱';
    }
    default:
      return '•';
  }
}

// ---------------------------------------------------------------------------
// journeyMarkdown — pure CausalChain → canvas markdown string
// ---------------------------------------------------------------------------

/** Format a relMs offset as a compact signed string (e.g. "-1500ms", "+0ms"). */
function fmtRel(relMs: number): string {
  const sign = relMs >= 0 ? '+' : '';
  return `${sign}${relMs}ms`;
}

/** Cap a string to at most `max` chars with a trailing "…" marker. */
function cap(s: string, max: number): string {
  return s.length <= max ? s : `${s.slice(0, max)}…`;
}

/**
 * Render a `CausalChain` to a Slack canvas markdown string.
 *
 * Layout:
 * - H1: failure headline
 * - narrative paragraph
 * - H2 "The path": ordered list of timeline entries (with emoji + relMs)
 * - H2 "Network failures": markdown table (capped under 300 cells)
 * - Code block: stack trace (if present)
 *
 * Long timelines are truncated at MAX_TIMELINE_ENTRIES with a "+N more" line.
 * Pure function — no side effects, fully unit-testable.
 */
export function journeyMarkdown(journey: JourneyCausalChain): string {
  const { error, narrative, timeline, networkErrors } = journey;

  const lines: string[] = [];

  // H1 — failure headline
  const headline = cap(error.message, 120);
  lines.push(`# ${error.level.toUpperCase()}: ${headline}`);
  lines.push('');

  // Narrative paragraph
  lines.push(narrative);
  lines.push('');

  // H2 "The path" — ordered timeline list
  lines.push('## The path');
  lines.push('');

  const visibleEntries =
    timeline.length <= MAX_TIMELINE_ENTRIES ? timeline : timeline.slice(0, MAX_TIMELINE_ENTRIES);
  const hiddenCount = timeline.length - visibleEntries.length;

  let i = 1;
  for (const entry of visibleEntries) {
    const emoji = kindEmoji(entry.kind, entry.summary);
    const rel = fmtRel(entry.relMs);
    lines.push(`${i}. ${emoji} \`${rel}\` ${cap(entry.summary, 200)}`);
    i++;
  }

  if (hiddenCount > 0) {
    lines.push(`${i}. … _+${hiddenCount} more entries (truncated)_`);
  }

  lines.push('');

  // H2 "Network failures" — markdown table (only if there are any)
  if (networkErrors.length > 0) {
    lines.push('## Network failures');
    lines.push('');
    lines.push('| Method | URL | Status |');
    lines.push('| --- | --- | --- |');

    const visibleNet =
      networkErrors.length <= MAX_TABLE_ROWS
        ? networkErrors
        : networkErrors.slice(0, MAX_TABLE_ROWS);
    const hiddenNet = networkErrors.length - visibleNet.length;

    for (const n of visibleNet) {
      // `!= null` catches both undefined (absent) and null (net-level failure,
      // no HTTP status) — a `null` row must fall through to errorText, not
      // render the literal "null".
      const status = n.status != null ? String(n.status) : (n.errorText ?? 'error');
      const url = cap(n.url, 80);
      lines.push(`| ${n.method} | ${url} | ${status} |`);
    }

    if (hiddenNet > 0) {
      lines.push(`| … | _+${hiddenNet} more_ | |`);
    }

    lines.push('');
  }

  // Code block — stack trace (if present)
  if (error.stack) {
    lines.push('## Stack trace');
    lines.push('');
    // Cap the stack to avoid canvas_too_large; 4000 chars is generous headroom
    const stack = cap(error.stack, 4000);
    lines.push('```');
    lines.push(stack);
    lines.push('```');
    lines.push('');
  }

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// journeyBlocks — Block Kit fallback (≤ SLACK_BLOCK_LIMIT blocks)
// ---------------------------------------------------------------------------

/** Maximum timeline entries in the Block Kit fallback message.
 *  1 section block per entry × 12 entries = 12 entry blocks;
 *  plus ~4 fixed blocks (header + narrative + divider + "The path" label) = ~16 total,
 *  well within SLACK_BLOCK_LIMIT (50). */
const MAX_BK_TIMELINE_ENTRIES = 12;

/**
 * Render a `CausalChain` to a Slack Block Kit message (array of KnownBlock[]).
 *
 * Used as the fallback when `canvases.create` is unavailable (free teams,
 * `canvas_disabled_user_team`, etc.). Truncates the timeline at
 * MAX_BK_TIMELINE_ENTRIES with a "+N more" context block, and caps the
 * total block count at SLACK_BLOCK_LIMIT.
 *
 * Pure function — no side effects.
 */
export function journeyBlocks(journey: JourneyCausalChain): KnownBlock[] {
  const { error, narrative, timeline } = journey;

  const blocks: KnownBlock[] = [];

  // Header — Slack `header` blocks hard-limit plain_text to 150 chars, so reserve
  // the level-prefix budget before capping the message (prefix + headline <= 150).
  // `cap` appends a 1-char "…" on truncation, so a header block never overflows
  // even when the capped headline hits the boundary.
  const prefix = `${error.level.toUpperCase()}: `;
  const headline = cap(error.message, Math.max(0, 150 - prefix.length - 1));
  blocks.push({
    type: 'header',
    text: { type: 'plain_text', text: `${prefix}${headline}` },
  });

  // Narrative section
  blocks.push({
    type: 'section',
    text: { type: 'mrkdwn', text: cap(narrative, 2900) },
  });

  // Divider before timeline
  blocks.push({ type: 'divider' });

  // "The path" label
  blocks.push({
    type: 'section',
    text: { type: 'mrkdwn', text: '*The path*' },
  });

  const visibleEntries =
    timeline.length <= MAX_BK_TIMELINE_ENTRIES
      ? timeline
      : timeline.slice(0, MAX_BK_TIMELINE_ENTRIES);
  const hiddenCount = timeline.length - visibleEntries.length;

  for (const entry of visibleEntries) {
    const emoji = kindEmoji(entry.kind, entry.summary);
    const rel = fmtRel(entry.relMs);
    blocks.push({
      type: 'section',
      text: { type: 'mrkdwn', text: `${emoji} \`${rel}\` ${cap(entry.summary, 200)}` },
    });
  }

  if (hiddenCount > 0) {
    blocks.push({
      type: 'context',
      elements: [
        {
          type: 'mrkdwn',
          text: `_+${hiddenCount} more timeline entries (use canvas for the full journey)_`,
        },
      ],
    });
  }

  // Cap at SLACK_BLOCK_LIMIT
  return blocks.slice(0, SLACK_BLOCK_LIMIT);
}

// ---------------------------------------------------------------------------
// Type guard — validate that an `unknown` value looks like a CausalChain
// ---------------------------------------------------------------------------

/** A timeline entry the renderers can safely dereference (kind/summary/relMs/ts). */
function isTimelineEntry(v: unknown): boolean {
  if (typeof v !== 'object' || v === null) return false;
  const t = v as Record<string, unknown>;
  return (
    typeof t.kind === 'string' &&
    typeof t.summary === 'string' &&
    typeof t.relMs === 'number' &&
    typeof t.ts === 'number'
  );
}

/** A network-error row the renderers can safely dereference (method/url; status/errorText optional). */
function isNetworkError(v: unknown): boolean {
  if (typeof v !== 'object' || v === null) return false;
  const n = v as Record<string, unknown>;
  return typeof n.method === 'string' && typeof n.url === 'string';
}

export function isJourneyCausalChain(v: unknown): v is JourneyCausalChain {
  if (typeof v !== 'object' || v === null) return false;
  const o = v as Record<string, unknown>;
  if (
    typeof o.errorId !== 'number' ||
    typeof o.narrative !== 'string' ||
    !Array.isArray(o.timeline)
  )
    return false;
  const err = o.error;
  if (typeof err !== 'object' || err === null) return false;
  const e = err as Record<string, unknown>;
  // `level` is dereferenced (`.toUpperCase()`) by the renderers, so guard it
  // too — not just `message` — to keep renderJourney total on malformed input.
  if (typeof e.message !== 'string' || typeof e.level !== 'string') return false;
  // The renderers dereference every timeline entry (kind/summary/relMs) and every
  // networkErrors row (method/url via cap()) — deep-validate both so an invalid
  // payload is rejected here, before any cap() call, keeping renderJourney total.
  if (!o.timeline.every(isTimelineEntry)) return false;
  if (!Array.isArray(o.networkErrors) || !o.networkErrors.every(isNetworkError)) return false;
  return true;
}
