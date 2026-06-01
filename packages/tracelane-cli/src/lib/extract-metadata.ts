// Pure metadata extraction from a tracelane HTML report. The report's bootstrap
// emits a `const META = ${JSON-stringified-ReportMeta};` line as part of its
// dataScript block (see packages/tracelane-report/src/template.ts). The
// meta-strip in the rendered hero contributes two more fields not in META:
// `Captured` (timestamp) and `Events` (count).
//
// This extractor is pure (string in → object out) so it's trivially unit-
// testable. It deliberately fails-soft: if the META line can't be parsed, it
// returns null and the caller logs + skips the report rather than crashing
// the index build on one malformed file.

export interface ExtractedMetadata {
  /** Spec file path, e.g. `tests/e2e/checkout.e2e.ts`. */
  spec?: string;
  /** Test title, e.g. `completes checkout with valid card details`. */
  title: string;
  /** Test outcome. `unknown` if the META status couldn't be parsed. */
  status: 'passed' | 'failed' | 'skipped' | 'broken' | 'unknown';
  /** Multi-line assertion / stack trace; absent on pass/skip. */
  error?: string;
  /** Total test duration in milliseconds. */
  durationMs?: number;
  /** Browser name, e.g. `chrome`. */
  browserName?: string;
  /** Browser version string. */
  browserVersion?: string;
  /** Viewport at recording start. */
  viewport?: { width: number; height: number };
  /** Git SHA (auto-detected from CI env vars by the report builder). */
  commitSha?: string;
  /** CI build URL (auto-detected). */
  buildUrl?: string;
  /** Render-time timestamp pulled from the meta-strip's "Captured" item. */
  capturedAt?: string;
  /** Recorded event count pulled from the meta-strip's "Events" item. */
  eventCount?: number;
}

const KNOWN_STATUSES = new Set<ExtractedMetadata['status']>([
  'passed',
  'failed',
  'skipped',
  'broken',
]);

/**
 * Extract metadata from a tracelane report HTML string.
 *
 * Returns null if the META const can't be located or parsed. The caller
 * should treat null as "this file isn't a tracelane report" and skip.
 */
export function extractMetadata(html: string): ExtractedMetadata | null {
  // Primary source: the inline `const META = {...};` declaration emitted by
  // the report template's bootstrap dataScript block. The real report
  // minifier collapses the bootstrap to a single line, so we anchor on the
  // next const declaration (EVENTS_GZ_B64) as a terminator rather than `$`.
  // Non-greedy [\s\S]*? handles nested objects (viewport, etc.) correctly
  // because the only `;const EVENTS_GZ_B64` sequence in the report is the
  // intended one.
  const metaMatch = html.match(/const META = (\{[\s\S]*?\});\s*const EVENTS_GZ_B64\b/);
  if (!metaMatch) return null;

  let parsedMeta: Record<string, unknown>;
  try {
    parsedMeta = JSON.parse(metaMatch[1] as string) as Record<string, unknown>;
  } catch {
    return null;
  }

  const title = typeof parsedMeta.title === 'string' ? parsedMeta.title : '(unknown title)';
  const rawStatus = typeof parsedMeta.status === 'string' ? parsedMeta.status : 'unknown';
  const status = (
    KNOWN_STATUSES.has(rawStatus as ExtractedMetadata['status']) ? rawStatus : 'unknown'
  ) as ExtractedMetadata['status'];

  const result: ExtractedMetadata = { title, status };

  if (typeof parsedMeta.spec === 'string') result.spec = parsedMeta.spec;
  if (typeof parsedMeta.error === 'string') result.error = parsedMeta.error;
  if (typeof parsedMeta.durationMs === 'number') result.durationMs = parsedMeta.durationMs;
  if (typeof parsedMeta.browserName === 'string') result.browserName = parsedMeta.browserName;
  if (typeof parsedMeta.browserVersion === 'string') {
    result.browserVersion = parsedMeta.browserVersion;
  }
  if (
    parsedMeta.viewport &&
    typeof parsedMeta.viewport === 'object' &&
    'width' in parsedMeta.viewport &&
    'height' in parsedMeta.viewport
  ) {
    const vp = parsedMeta.viewport as { width: unknown; height: unknown };
    if (typeof vp.width === 'number' && typeof vp.height === 'number') {
      result.viewport = { width: vp.width, height: vp.height };
    }
  }
  if (typeof parsedMeta.commitSha === 'string') result.commitSha = parsedMeta.commitSha;
  if (typeof parsedMeta.buildUrl === 'string') result.buildUrl = parsedMeta.buildUrl;

  // Secondary: pull Captured + Events out of the rendered meta-strip. These
  // fields aren't on ReportMeta — they're computed at report-build time.
  const capturedMatch = html.match(
    /<span class="label">Captured<\/span><span class="value">([^<]+)<\/span>/,
  );
  if (capturedMatch?.[1]) result.capturedAt = capturedMatch[1];

  const eventsMatch = html.match(
    /<span class="label">Events<\/span><span class="value">([^<]+)<\/span>/,
  );
  if (eventsMatch) {
    const n = Number.parseInt((eventsMatch[1] as string).replace(/,/g, ''), 10);
    if (!Number.isNaN(n)) result.eventCount = n;
  }

  return result;
}

/**
 * Return the first non-empty line of an error string, trimmed and clamped.
 * Used by the index card to surface a one-line excerpt without leaking the
 * full stack trace.
 */
export function errorExcerpt(error: string | undefined, maxChars = 140): string {
  if (!error) return '';
  const firstLine = error.split('\n')[0]?.trim() ?? '';
  if (firstLine.length <= maxChars) return firstLine;
  return `${firstLine.slice(0, maxChars - 1)}…`;
}
