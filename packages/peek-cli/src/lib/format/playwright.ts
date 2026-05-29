// `--format playwright`: emit a runnable Playwright `test(...)` repro from a
// session's rrweb stream (K.2 alpha.7 fix). This wires the CLI to the SAME
// code path the MCP `generate_playwright_repro` tool uses — Phase 3c Task 3.13,
// implemented in `@peekdev/mcp/mcp/playwright-repro`. CLI and AI consumers MUST
// produce identical output for the same session (P2 PRD §B3 cross-surface
// parity guarantee).
//
// The MCP tool walks the in-memory eventWithTime[] directly; the CLI reads
// the on-disk gzipped blob first (via @peekdev/mcp/mcp/event-blobs), then
// hands the decoded events to the shared generator. The session metadata
// (used as the test title) comes from the same SessionDetail the markdown +
// json formatters consume.
//
// Pre-K.2, this format returned a non-ok "not yet implemented (Phase 3c Task
// 3.13)" message because the walker lived in peek-mcp and wasn't published
// as a sub-path export. Alpha.7 adds the `./mcp/playwright-repro` and
// `./mcp/event-blobs` sub-path exports so the CLI can import the generator
// + the on-disk blob loader directly, with no code forking.

import { loadSessionEvents } from '@peekdev/mcp/mcp/event-blobs';
import { generatePlaywrightRepro } from '@peekdev/mcp/mcp/playwright-repro';
import type { SessionDetail } from '../db.js';

/**
 * Render a hydrated session as a Playwright `.spec.ts` test string. Returns
 * the script verbatim — no trailing newline mutation — so byte-identical
 * comparison with the MCP tool output works for tests.
 *
 * If the session has no recorded event blob (active session pre-flush, or
 * blob pruned by retention), the generator still emits a valid `test(...)`
 * shell with a `// No user actions were recorded` placeholder so the user
 * gets a script they can edit, not an empty file.
 */
export function formatSessionPlaywright(detail: SessionDetail, blobPath?: string): string {
  const events = blobPath !== undefined && blobPath.length > 0 ? loadSessionEvents(blobPath) : [];
  return generatePlaywrightRepro(events, {
    title: detail.session.title ?? `peek session ${detail.session.id}`,
  });
}
