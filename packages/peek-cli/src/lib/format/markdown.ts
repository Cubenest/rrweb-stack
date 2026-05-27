// `--format markdown`: structured for AI paste, mirroring Playwright's "Copy
// Prompt" convention (P2 PRD §C.3). Section order is fixed:
//   ## Page
//   ## Console errors
//   ## Failed requests
//   ## User actions before error
//   ## Suggested reproduction
// Pure: SessionDetail in, Markdown string out.
//
// Note on the last two sections: per-event user actions live in the gzipped
// rrweb blob, surfaced by the MCP `get_user_action_before_error` /
// `generate_playwright_repro` tools (Phase 3c). The CLI markdown export reads
// only the extracted SQL rows, so it states where the richer data lives rather
// than fabricating it.

import type { ConsoleEventRow, NetworkEventRow, SessionDetail } from '../db.js';

function isoFromMs(tsMs: number): string {
  return new Date(tsMs).toISOString();
}

function consoleSection(rows: ConsoleEventRow[]): string {
  if (rows.length === 0) return 'No console errors recorded.';
  return rows
    .map((r) => {
      const head = `- \`${r.level}\` ${isoFromMs(r.ts)} — ${r.message}`;
      if (!r.stack) return head;
      const stack = r.stack
        .split('\n')
        .map((line) => `    ${line}`)
        .join('\n');
      return `${head}\n${stack}`;
    })
    .join('\n');
}

function networkSection(rows: NetworkEventRow[]): string {
  if (rows.length === 0) return 'No failed requests recorded.';
  return rows
    .map((r) => {
      const status = r.status ?? (r.errorText ? `ERR ${r.errorText}` : 'pending');
      const dur = r.durationMs != null ? ` (${r.durationMs}ms)` : '';
      return `- ${r.method} ${r.url} → ${status}${dur}`;
    })
    .join('\n');
}

/** Render a session as the §C.3 Markdown AI-paste format. */
export function formatSessionMarkdown(detail: SessionDetail): string {
  const { session, counts, consoleErrors, networkErrors } = detail;
  const title = session.title ?? '(untitled session)';
  const lines: string[] = [];

  lines.push(`# Peek session ${session.id}`);
  lines.push('');

  lines.push('## Page');
  lines.push(`- Title: ${title}`);
  lines.push(`- URL: ${session.url ?? '(unknown)'}`);
  lines.push(`- Origin: ${session.origin ?? '(unknown)'}`);
  lines.push(`- Started: ${session.createdAt}`);
  lines.push(`- Updated: ${session.updatedAt}`);
  lines.push(`- Status: ${session.status}`);
  lines.push(
    `- Events: ${session.eventCount} · Console errors: ${counts.consoleErrors} · Failed requests: ${counts.networkErrors}`,
  );
  lines.push('');

  lines.push('## Console errors');
  lines.push(consoleSection(consoleErrors));
  lines.push('');

  lines.push('## Failed requests');
  lines.push(networkSection(networkErrors));
  lines.push('');

  lines.push('## User actions before error');
  lines.push(
    'User-action timeline lives in the recorded rrweb stream. Use the MCP tool ' +
      '`get_user_action_before_error` (peek-mcp) for the click/type/navigation sequence.',
  );
  lines.push('');

  lines.push('## Suggested reproduction');
  lines.push(
    `Generate a Playwright repro with \`peek sessions export ${session.id} --format playwright\`, or the MCP \`generate_playwright_repro\` tool.`,
  );
  lines.push('');

  return lines.join('\n');
}
