// Pure index renderer. Given a list of (filename, extracted metadata) pairs,
// produce a single self-contained HTML index page with one card per report.
//
// The aesthetic mirrors the report itself (Editorial Postmortem: Fraunces
// serif headlines, JetBrains Mono body, dark slate background, amber failure
// accent). Fonts are NOT inlined here — the index uses system serif/mono so
// the page loads instantly without the ~170 KB woff2 cost. Each card links
// to its source report file relative to the index.

import { type ExtractedMetadata, errorExcerpt } from './extract-metadata.js';

/** HTML-escape a string for safe interpolation into element text / attributes. */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export interface IndexEntry {
  /** Filename of the source report (relative to the index's output dir). */
  filename: string;
  /** Extracted metadata, or null if the file failed to parse. */
  meta: ExtractedMetadata | null;
}

export interface RenderIndexInput {
  /** All entries to render. Already sorted by the caller. */
  entries: IndexEntry[];
  /** Optional title for the index page. Default: `tracelane index`. */
  title?: string;
  /** Render timestamp. Defaults to new Date(). */
  generatedAt?: Date;
}

/** Format a duration in ms as a compact human label (e.g. `12.5 s`, `1m 34s`). */
function formatDuration(ms: number | undefined): string {
  if (ms === undefined) return '—';
  if (ms < 1000) return `${ms} ms`;
  const seconds = ms / 1000;
  if (seconds < 60) return `${seconds.toFixed(1)} s`;
  const minutes = Math.floor(seconds / 60);
  const rest = Math.round(seconds - minutes * 60);
  return `${minutes}m ${rest}s`;
}

function formatBrowser(meta: ExtractedMetadata): string {
  if (!meta.browserName) return '—';
  const name = meta.browserName.charAt(0).toUpperCase() + meta.browserName.slice(1);
  const ver = meta.browserVersion ? ` ${meta.browserVersion.split('.')[0]}` : '';
  const vp = meta.viewport ? ` · ${meta.viewport.width}×${meta.viewport.height}` : '';
  return `${name}${ver}${vp}`;
}

function renderStatusPill(status: ExtractedMetadata['status']): string {
  const label = status.toUpperCase();
  return `<span class="status ${status}">${label}</span>`;
}

function renderCard(entry: IndexEntry): string {
  const { filename, meta } = entry;
  if (!meta) {
    return `<a class="card unparsed" href="${escapeHtml(filename)}">
  <div class="card-head">
    <span class="status unknown">UNPARSED</span>
    <span class="filename">${escapeHtml(filename)}</span>
  </div>
  <p class="title-row">Could not extract metadata. Click through to inspect the raw report.</p>
</a>`;
  }

  const excerpt = errorExcerpt(meta.error);
  const specRow = meta.spec ? `<div class="spec">${escapeHtml(meta.spec)}</div>` : '';
  const errorRow =
    excerpt && (meta.status === 'failed' || meta.status === 'broken')
      ? `<p class="error">${escapeHtml(excerpt)}</p>`
      : '';
  const footRow = [formatDuration(meta.durationMs), formatBrowser(meta), meta.capturedAt ?? '—']
    .map((s) => `<span>${escapeHtml(s)}</span>`)
    .join('<span class="sep">·</span>');

  return `<a class="card status-${meta.status}" href="${escapeHtml(filename)}">
  <div class="card-head">
    ${renderStatusPill(meta.status)}
    ${specRow}
  </div>
  <h2 class="title-row">${escapeHtml(meta.title)}</h2>
  ${errorRow}
  <div class="foot">${footRow}</div>
</a>`;
}

/**
 * Render the full index HTML. Single self-contained file (no remote fetches),
 * uses system fonts so it loads instantly even with 200+ cards.
 */
export function renderIndex(input: RenderIndexInput): string {
  const { entries } = input;
  const title = input.title ?? 'tracelane index';
  const generated = input.generatedAt ?? new Date();

  const counts = {
    total: entries.length,
    failed: entries.filter((e) => e.meta?.status === 'failed').length,
    broken: entries.filter((e) => e.meta?.status === 'broken').length,
    passed: entries.filter((e) => e.meta?.status === 'passed').length,
    skipped: entries.filter((e) => e.meta?.status === 'skipped').length,
    unparsed: entries.filter((e) => !e.meta).length,
  };

  const summary = `${counts.total} report${counts.total === 1 ? '' : 's'} · ${counts.failed + counts.broken} failed · ${counts.passed} passed${counts.skipped ? ` · ${counts.skipped} skipped` : ''}${counts.unparsed ? ` · ${counts.unparsed} unparsed` : ''}`;

  const cards = entries.map(renderCard).join('\n');

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>
:root {
  color-scheme: dark;
  --bg: #0f1115;
  --surface: #171a20;
  --surface-2: #1d2027;
  --border: #2a2e36;
  --border-strong: #383d47;
  --text: #e7e5e1;
  --muted: #8a92a0;
  --teal: #5eead4;
  --amber: #f5a364;
  --amber-dim: rgba(245, 163, 100, 0.18);
  --serif: ui-serif, Georgia, 'Times New Roman', serif;
  --mono: ui-monospace, 'SF Mono', Menlo, Consolas, monospace;
}
* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; }
body {
  font-family: var(--mono);
  font-size: 13px;
  line-height: 1.55;
  color: var(--text);
  background: var(--bg);
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
}
a { color: inherit; text-decoration: none; }

.hero {
  padding: 32px 48px 24px;
  border-bottom: 1px solid var(--border);
}
.hero h1 {
  font-family: var(--serif);
  font-weight: 500;
  font-style: italic;
  font-size: clamp(24px, 3vw, 32px);
  margin: 0 0 8px;
  letter-spacing: -0.01em;
}
.hero .summary {
  font-family: var(--mono);
  font-size: 12px;
  color: var(--muted);
  letter-spacing: 0.04em;
}
.hero .generated {
  font-family: var(--mono);
  font-size: 11px;
  color: var(--muted);
  margin-top: 4px;
}

main.grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
  gap: 16px;
  padding: 24px 48px 48px;
}
@media (max-width: 720px) {
  .hero { padding: 24px; }
  main.grid { padding: 16px; gap: 12px; }
}

.card {
  display: block;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 16px 18px;
  transition: border-color 0.12s ease, transform 0.12s ease;
}
.card:hover {
  border-color: var(--border-strong);
  transform: translateY(-1px);
}
.card.status-failed, .card.status-broken {
  border-left: 3px solid var(--amber);
}
.card.status-passed {
  border-left: 3px solid var(--teal);
}
.card.unparsed {
  border-left: 3px solid var(--muted);
}

.card-head {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
  flex-wrap: wrap;
}
.status {
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.12em;
  padding: 2px 6px;
  border-radius: 3px;
  background: rgba(0, 0, 0, 0.25);
  border: 1px solid var(--border);
  color: var(--muted);
}
.status.failed, .status.broken { color: var(--amber); border-color: var(--amber-dim); }
.status.passed { color: var(--teal); border-color: rgba(94, 234, 212, 0.3); }
.spec, .filename {
  font-family: var(--mono);
  font-size: 11px;
  color: var(--muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  flex: 1;
  min-width: 0;
}

.title-row {
  font-family: var(--serif);
  font-weight: 500;
  font-size: 16px;
  line-height: 1.3;
  margin: 0 0 10px;
  color: var(--text);
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.error {
  font-family: var(--mono);
  font-size: 11px;
  color: var(--muted);
  margin: 0 0 12px;
  padding-left: 8px;
  border-left: 2px solid var(--border-strong);
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.foot {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 10px;
  color: var(--muted);
  letter-spacing: 0.02em;
  flex-wrap: wrap;
}
.foot .sep { opacity: 0.4; }

footer {
  padding: 16px 48px 24px;
  border-top: 1px solid var(--border);
  font-size: 11px;
  color: var(--muted);
}
footer a { color: var(--teal); }
</style>
</head>
<body>
<section class="hero">
  <h1>${escapeHtml(title)}</h1>
  <div class="summary">${escapeHtml(summary)}</div>
  <div class="generated">Generated ${escapeHtml(generated.toISOString())}</div>
</section>
<main class="grid">
${cards}
</main>
<footer>
  Generated by <a href="https://github.com/Cubenest/rrweb-stack/tree/main/packages/tracelane-cli">tracelane index</a> — single-file CI failure triage. No SaaS, no telemetry.
</footer>
</body>
</html>`;
}
