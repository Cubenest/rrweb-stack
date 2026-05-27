// Export-format dispatch (P2 PRD §C.3). `markdown` and `json` are implemented
// fully (self-contained AI-paste formats read straight from the extracted SQL
// rows). `html` (self-contained rrweb replay) and `playwright` (repro
// boilerplate) are deferred:
//   - html would require bundling an rrweb player inline; importing
//     @tracelane/report is explicitly forbidden (ADR-0001 product independence),
//     so a peek-specific viewer is a tracked follow-up.
//   - playwright overlaps the MCP `generate_playwright_repro` tool (Phase 3c
//     Task 3.13); the repro walker should live there and be shared, rather than
//     forked here. Tracked follow-up.
// The stubs return a non-ok result so the command shell exits non-zero with a
// clear message (never silently emit an empty/partial file).

import type { SessionDetail } from '../db.js';
import { formatSessionJson } from './json.js';
import { formatSessionMarkdown } from './markdown.js';

/** Supported `--format` values (P2 PRD §C.1). */
export const EXPORT_FORMATS = ['markdown', 'json', 'html', 'playwright'] as const;
export type ExportFormat = (typeof EXPORT_FORMATS)[number];

export function isExportFormat(value: string): value is ExportFormat {
  return (EXPORT_FORMATS as readonly string[]).includes(value);
}

/** Result of rendering: either content to write, or a not-implemented message. */
export type FormatResult =
  | { readonly ok: true; readonly content: string }
  | { readonly ok: false; readonly message: string };

/** Render a hydrated session in the requested format. */
export function formatSession(detail: SessionDetail, format: ExportFormat): FormatResult {
  switch (format) {
    case 'markdown':
      return { ok: true, content: formatSessionMarkdown(detail) };
    case 'json':
      return { ok: true, content: formatSessionJson(detail) };
    case 'html':
      return {
        ok: false,
        message:
          "export format 'html' is not yet implemented (a peek-specific self-contained " +
          'rrweb replay viewer is tracked for a follow-up; @tracelane/report is intentionally ' +
          'not reused — ADR-0001 product independence). Use --format markdown or json.',
      };
    case 'playwright':
      return {
        ok: false,
        message:
          "export format 'playwright' is not yet implemented (the repro generator overlaps the " +
          'MCP `generate_playwright_repro` tool, Phase 3c Task 3.13, and will share that walker). ' +
          'Use --format markdown or json.',
      };
  }
}
