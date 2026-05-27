// Metadata header (Task 2.11).
//
// Two responsibilities:
//   • resolveCiMetadata — fill commit SHA + build URL from CI env vars when the
//     caller didn't supply them (GITHUB_SHA / CI_COMMIT_SHA, and common build
//     URL conventions for GitHub Actions + GitLab CI).
//   • renderMetaHeader — the <header class="meta"> markup (spec, title, status,
//     duration, browser, viewport, commit, build URL), HTML-escaped.

import { escapeHtml } from './html';
import type { ReportMeta } from './types';

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

function row(term: string, value: string): string {
  return `<dt>${escapeHtml(term)}</dt><dd>${value}</dd>`;
}

/** Render the metadata header markup (P1 PRD §F.1). */
export function renderMetaHeader(meta: ReportMeta): string {
  const rows: string[] = [];
  if (meta.spec) rows.push(row('Spec', escapeHtml(meta.spec)));
  if (meta.durationMs !== undefined)
    rows.push(row('Duration', escapeHtml(formatDuration(meta.durationMs))));

  const browser = [meta.browserName, meta.browserVersion].filter(Boolean).join(' ');
  if (browser) rows.push(row('Browser', escapeHtml(browser)));
  if (meta.viewport) {
    rows.push(row('Viewport', escapeHtml(`${meta.viewport.width} × ${meta.viewport.height}`)));
  }
  if (meta.commitSha) rows.push(row('Commit', `<code>${escapeHtml(meta.commitSha)}</code>`));
  if (meta.buildUrl) {
    const safe = escapeHtml(meta.buildUrl);
    rows.push(row('Build', `<a href="${safe}">${safe}</a>`));
  }

  const error = meta.error ? `<div class="error">${escapeHtml(meta.error)}</div>` : '';

  return `<header class="meta">
<h1>${escapeHtml(meta.title)} <span class="status ${escapeHtml(meta.status)}">${escapeHtml(meta.status)}</span></h1>
${rows.length ? `<dl>${rows.join('')}</dl>` : ''}
${error}
</header>`;
}
