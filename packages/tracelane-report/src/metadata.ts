// Metadata header (Task 2.11 + Phase 6 hero rewrite).
//
// Two responsibilities:
//   • resolveCiMetadata — fill commit SHA + build URL from CI env vars when the
//     caller didn't supply them (GITHUB_SHA / CI_COMMIT_SHA, and common build
//     URL conventions for GitHub Actions + GitLab CI).
//   • renderHero — the new editorial-postmortem `<section class="hero">` markup:
//     eyebrow strip (status + spec + duration + browser), serif headline with
//     the test title + status framing, monospace error block, then the
//     `.meta-strip` of small key-value pairs (spec / commit / build / captured /
//     events). HTML-escaped throughout; javascript: URLs become text, not links.

import { escapeHtml } from './html.js';
import type { ReportMeta } from './types.js';

/** Read an env var without a hard `@types/node` dependency (platform-light). */
function readEnv(name: string): string | undefined {
  const proc = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process;
  return proc?.env?.[name];
}

/** First defined, non-empty env value among `names`. */
function firstEnv(names: string[]): string | undefined {
  for (const name of names) {
    const v = readEnv(name);
    if (v !== undefined && v !== '') return v;
  }
  return undefined;
}

/** Derive a CI build/run URL from common provider env vars. */
function detectBuildUrl(): string | undefined {
  // GitHub Actions: assemble the run URL from the documented pieces.
  const server = readEnv('GITHUB_SERVER_URL');
  const repo = readEnv('GITHUB_REPOSITORY');
  const runId = readEnv('GITHUB_RUN_ID');
  if (server && repo && runId) return `${server}/${repo}/actions/runs/${runId}`;
  // GitLab CI exposes the job URL directly.
  return firstEnv(['CI_JOB_URL', 'CI_PIPELINE_URL', 'BUILD_URL']);
}

/**
 * Return `meta` with `commitSha` / `buildUrl` filled from the environment when
 * absent. Explicit values always win; auto-detection only fills gaps.
 */
export function resolveCiMetadata(meta: ReportMeta): ReportMeta {
  const commitSha = meta.commitSha ?? firstEnv(['GITHUB_SHA', 'CI_COMMIT_SHA']);
  const buildUrl = meta.buildUrl ?? detectBuildUrl();
  return {
    ...meta,
    ...(commitSha !== undefined ? { commitSha } : {}),
    ...(buildUrl !== undefined ? { buildUrl } : {}),
  };
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms} ms`;
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(s < 10 ? 2 : 1)} s`;
  const m = Math.floor(s / 60);
  return `${m}m ${Math.round(s - m * 60)}s`;
}

/**
 * Whether `url` is safe to use as an `href`. Only http(s) — blocks `javascript:`,
 * `data:`, `vbscript:` etc. The build URL is sourced from CI env vars
 * (CI_JOB_URL / BUILD_URL), which a hostile or misconfigured CI could set, so a
 * crafted `javascript:` value must never become a clickable link in the saved
 * report's origin. (HTML-escaping alone doesn't help — `javascript:alert(1)`
 * has none of the escaped characters.)
 */
function isSafeUrl(url: string): boolean {
  try {
    return /^https?:$/i.test(new URL(url).protocol);
  } catch {
    return false;
  }
}

/** A status's human-facing display verb in the headline ("failed" → "failed"). */
function statusVerb(status: string): string {
  switch (status) {
    case 'failed':
      return 'failed';
    case 'broken':
      return 'errored';
    case 'passed':
      return 'passed';
    case 'skipped':
      return 'was skipped';
    default:
      return status;
  }
}

/** Format an ISO timestamp into a compact "2026-05-30 18:47 UTC" rendering. */
function formatCapturedAt(d: Date): string {
  const pad = (n: number): string => String(n).padStart(2, '0');
  return (
    `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ` +
    `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())} UTC`
  );
}

/** Build one `.meta-strip .item` block: label + value, value may contain HTML. */
function stripItem(label: string, valueHtml: string): string {
  return `<div class="item"><span class="label">${escapeHtml(label)}</span><span class="value">${valueHtml}</span></div>`;
}

/**
 * Render the new hero + meta-strip (Phase 6).
 *
 * Replaces the old `<header class="meta">` shape. The visible structure:
 *
 *   <section class="hero">
 *     <div class="eyebrow">…status pill + spec + duration + browser…</div>
 *     <h1 class="what">…title with <em> emphasized inside…</h1>
 *     <pre class="error-message">…verbatim error stack trace…</pre>
 *     <div class="meta-strip">…6 small key-value items…</div>
 *   </section>
 *
 * The status pill keeps `class="status <status>"` so existing test assertions
 * for "class=\"status failed\"" still match; the commit value still ships
 * inside `<code>` and the buildUrl still becomes an `<a href="…">` for safe
 * URLs only.
 *
 * `eventCount` is rendered when non-undefined; the caller (template.ts) passes
 * `events.length` after `pruneToSizeBudget` runs.
 */
export function renderHero(meta: ReportMeta, eventCount?: number, capturedAt?: Date): string {
  // ---- Eyebrow row -------------------------------------------------------
  // Status pill (always shown), then spec / duration / browser separated by
  // thin dividers. Each piece is optional except the status.
  const TRACELANE_MARK = `<svg class="tracelane-mark" xmlns="http://www.w3.org/2000/svg" viewBox="36 96 184 64" height="14" role="img" aria-label="tracelane" style="display:inline-block;vertical-align:middle;flex-shrink:0"><g fill="none" stroke="#C2563D" stroke-width="8" stroke-linecap="round" stroke-linejoin="round"><rect x="40" y="100" width="176" height="56" rx="4"/><path d="M64 128L96 128"/><path d="M112 128L144 128"/><path d="M160 128L192 128"/></g><circle cx="208" cy="128" r="6" fill="#C2563D"/></svg>`;

  // The brand mark is NOT part of the separator-joined bits — joining it would
  // render a stray "/" between the logo and the status pill (audit A-11). It is
  // prepended verbatim; the first visible "/" should be between status and spec.
  const eyebrowBits: string[] = [
    `<span class="dot" aria-hidden="true"></span><span class="status ${escapeHtml(meta.status)}">test ${escapeHtml(statusVerb(meta.status))}</span>`,
  ];
  if (meta.spec) eyebrowBits.push(`<span>${escapeHtml(meta.spec)}</span>`);
  if (meta.durationMs !== undefined)
    eyebrowBits.push(`<span>${escapeHtml(formatDuration(meta.durationMs))}</span>`);
  const browser = [meta.browserName, meta.browserVersion].filter(Boolean).join(' ');
  if (browser || meta.viewport) {
    const browserBits = [
      browser,
      meta.viewport ? `${meta.viewport.width}×${meta.viewport.height}` : '',
    ]
      .filter(Boolean)
      .join(' · ');
    eyebrowBits.push(`<span>${escapeHtml(browserBits)}</span>`);
  }
  const eyebrow = `<div class="eyebrow">${TRACELANE_MARK}${eyebrowBits.join('<span class="sep" aria-hidden="true">/</span>')}</div>`;

  // ---- Headline ----------------------------------------------------------
  // Format: "<test title> — <emphasized status verb>." Always one sentence; the
  // emphasized clause is the colour-of-the-failure-state moment.
  const headline = `<h1 class="what">${escapeHtml(meta.title)} <em>${escapeHtml(statusVerb(meta.status))}</em>.</h1>`;

  // ---- Error block (when present) ---------------------------------------
  const errorBlock = meta.error ? `<pre class="error-message">${escapeHtml(meta.error)}</pre>` : '';

  // ---- Meta strip --------------------------------------------------------
  const stripItems: string[] = [];
  if (meta.spec) stripItems.push(stripItem('Spec', escapeHtml(meta.spec)));
  if (meta.durationMs !== undefined)
    stripItems.push(stripItem('Duration', escapeHtml(formatDuration(meta.durationMs))));
  if (meta.commitSha)
    stripItems.push(stripItem('Commit', `<code>${escapeHtml(meta.commitSha)}</code>`));
  if (meta.buildUrl) {
    const escapedHref = escapeHtml(meta.buildUrl);
    const value = isSafeUrl(meta.buildUrl)
      ? `<a href="${escapedHref}">${escapedHref}</a>`
      : escapedHref;
    stripItems.push(stripItem('Build', value));
  }
  const capturedDate = capturedAt ?? new Date();
  stripItems.push(stripItem('Captured', escapeHtml(formatCapturedAt(capturedDate))));
  if (eventCount !== undefined) {
    stripItems.push(stripItem('Events', escapeHtml(eventCount.toLocaleString('en-US'))));
  }
  const strip = stripItems.length ? `<div class="meta-strip">${stripItems.join('')}</div>` : '';

  return `<section class="hero">${eyebrow}${headline}${errorBlock}${strip}</section>`;
}
