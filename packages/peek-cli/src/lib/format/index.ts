// Export-format dispatch (P2 PRD §C.3). `markdown`, `json`, and `playwright`
// are implemented fully:
//   - markdown / json: self-contained AI-paste formats, read straight from
//     the extracted SQL rows (consoleErrors / networkErrors).
//   - playwright (K.2 alpha.7 fix): wires to the SAME walker the MCP
//     `generate_playwright_repro` tool uses via `@peekdev/mcp/mcp/playwright-
//     repro` + `@peekdev/mcp/mcp/event-blobs`. CLI + AI consumers produce
//     identical output for the same session (P2 PRD §B3 parity guarantee).
//
// `html` (self-contained rrweb replay) stays deferred — it would require
// bundling an rrweb player inline; importing @tracelane/report is explicitly
// forbidden (ADR-0001 product independence), so a peek-specific viewer is a
// tracked follow-up. The stub returns a non-ok result so the command shell
// exits non-zero with a clear message (never silently emit an empty/partial
// file).

import type { SessionDetail } from '../db.js';
import { formatSessionJson } from './json.js';
import { formatSessionMarkdown } from './markdown.js';
import { formatSessionPlaywright } from './playwright.js';

/** Supported `--format` values (P2 PRD §C.1). */
export const EXPORT_FORMATS = ['markdown', 'json', 'html', 'playwright', 'bundle'] as const;
export type ExportFormat = (typeof EXPORT_FORMATS)[number];

export function isExportFormat(value: string): value is ExportFormat {
  return (EXPORT_FORMATS as readonly string[]).includes(value);
}

/** Result of rendering: either content to write, or a not-implemented message. */
export type FormatResult =
  | { readonly ok: true; readonly content: string }
  | { readonly ok: false; readonly message: string };

/**
 * Optional ancillary data the formatter may need beyond `SessionDetail`. The
 * playwright format needs `blobPath` (the `sessions.events_blob_path` value)
 * to load the gzipped rrweb stream from disk; markdown / json work purely
 * from the SQL rows already on `detail` and ignore it.
 */
export interface FormatOptions {
  /** Relative path to the session's gzipped event blob, for the playwright walker. */
  readonly blobPath?: string;
}

/** Render a hydrated session in the requested format. */
export function formatSession(
  detail: SessionDetail,
  format: ExportFormat,
  options: FormatOptions = {},
): FormatResult {
  switch (format) {
    case 'markdown':
      return { ok: true, content: formatSessionMarkdown(detail) };
    case 'json':
      return { ok: true, content: formatSessionJson(detail) };
    case 'playwright':
      return {
        ok: true,
        content: formatSessionPlaywright(
          detail,
          ...(options.blobPath !== undefined ? [options.blobPath] : []),
        ),
      };
    case 'html':
      return {
        ok: false,
        message:
          "export format 'html' is not yet implemented (a peek-specific self-contained " +
          'rrweb replay viewer is tracked for a follow-up). Use --format markdown or json.',
      };
    case 'bundle':
      // Binary export — branches in runExport before formatSession is called.
      // This arm is unreachable in normal execution; guarded here so the switch
      // exhausts all ExportFormat values and TypeScript is satisfied.
      return {
        ok: false,
        message:
          "export format 'bundle' is a binary export and must not be called through formatSession",
      };
  }
}
