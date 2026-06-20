// Audit log writer (Task 3.25, ADR-0010 / P2 PRD §H.3).
//
// Every act-tool call (execute_action AND request_authorization) appends ONE
// JSON line to ~/.peek/audit.log. The CLI's `peek audit log [--since 1h |
// --tool execute_action | --client cursor]` reads + filters this file.
//
// JSONL fields (P2 PRD §H.3):
//   ts            ISO timestamp the host received the tool call
//   tool          'execute_action' | 'request_authorization'
//   args          the Action object (passwords / token values redacted)
//   approvalTs    ISO when the user confirmed (Level 3) — omitted on YOLO auto
//   approver      'user' | 'allow-list-match' | 'level-4-auto' | 'level-2-suggest' | 'level-1-read'
//   client        MCP client name from clientInfo (cursor, claude-code, etc.)
//   sessionId     the recording session id the action targets
//   result        'ok' | 'denied' | 'error'
//
// Append-only: open the file with `flag: 'a'` for every write. We don't keep a
// long-lived file handle — a single act-tool call writes one line and closes,
// which is robust against host restarts / crashes mid-write. The line is
// flushed before the function resolves.

import { appendFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { peekHomeDir } from '../db/open.js';
import { type Action, redactActionForAudit } from '../mcp/action-schema.js';

/** Default location of the audit log (mirrors peek-cli/src/lib/peek-home.ts). */
export function auditLogPath(): string {
  return join(peekHomeDir(), 'audit.log');
}

/** Tool names that produce audit entries — the two Level-3+ MCP write tools. */
export type AuditTool = 'execute_action' | 'request_authorization';

/** Approver values, ordered by what the dispatcher will record. */
export type AuditApprover =
  | 'user'
  | 'allow-list-match'
  | 'level-4-auto'
  | 'level-2-suggest'
  | 'level-1-read';

/** Result values. */
export type AuditResult = 'ok' | 'denied' | 'error';

/** A single audit entry shape — matches the CLI's AuditEntry interface. */
export interface AuditEntry {
  ts: string;
  tool: AuditTool;
  /** The action object, with sensitive fields redacted before this is built. */
  args: unknown;
  approvalTs?: string;
  approver: AuditApprover;
  client: string;
  sessionId: string;
  result: AuditResult;
  /** Optional: the destructive term that fired (for diagnostics). */
  destructiveTerm?: string;
  /** Optional: human-readable error detail when result === 'error' / 'denied'. */
  error?: string;
}

/** Inputs to the writer — the caller supplies the Action; we redact it. */
export interface BuildAuditEntryInput {
  readonly tool: AuditTool;
  readonly action: Action;
  readonly approver: AuditApprover;
  readonly client: string;
  readonly sessionId: string;
  readonly result: AuditResult;
  /** ms-since-epoch of the request — omit to use Date.now() at build time. */
  readonly nowMs?: number;
  /** ms-since-epoch of the user's confirmation, if applicable. */
  readonly approvalMs?: number;
  readonly destructiveTerm?: string;
  readonly error?: string;
}

/**
 * Build the JSON line for one audit entry. Pure — no filesystem — so it
 * unit-tests cleanly. The `args` field is the Action with sensitive fields
 * (`TypeAction.text`, `NavigateAction.url` query-string values) redacted via
 * {@link redactActionForAudit}.
 */
export function buildAuditEntry(input: BuildAuditEntryInput): AuditEntry {
  const ts = new Date(input.nowMs ?? Date.now()).toISOString();
  const entry: AuditEntry = {
    ts,
    tool: input.tool,
    args: redactActionForAudit(input.action),
    approver: input.approver,
    client: input.client,
    sessionId: input.sessionId,
    result: input.result,
  };
  if (input.approvalMs !== undefined) {
    entry.approvalTs = new Date(input.approvalMs).toISOString();
  }
  if (input.destructiveTerm !== undefined) entry.destructiveTerm = input.destructiveTerm;
  if (input.error !== undefined) entry.error = input.error;
  return entry;
}

/** Serialize an entry to its single-line JSONL representation (trailing \n). */
export function serializeAuditEntry(entry: AuditEntry): string {
  return `${JSON.stringify(entry)}\n`;
}

export interface AuditWriteOptions {
  /** Override the audit log path (tests + PEEK_HOME). */
  readonly path?: string;
}

/**
 * Append an entry to the audit log, ensuring `~/.peek` exists first. Throws on
 * I/O failure — the host's caller catches + downgrades to a console.error so a
 * write-failure on the audit log can't tear down an action request mid-flight,
 * but the throw is propagated so tests can assert on it.
 *
 * The audit log contains URL paths, DOM selectors, MCP-client identity, and
 * session IDs. On a multi-user POSIX system we want owner-only access, so on
 * first write we seed the file with mode `0o600`. If the file already exists
 * we don't touch its mode — the user may have set their own. Windows ignores
 * the `mode` argument silently; that's acceptable here.
 */
export function appendAuditEntry(entry: AuditEntry, options: AuditWriteOptions = {}): void {
  const path = options.path ?? auditLogPath();
  mkdirSync(dirname(path), { recursive: true });
  if (!existsSync(path)) {
    writeFileSync(path, '', { mode: 0o600 });
  }
  appendFileSync(path, serializeAuditEntry(entry), { encoding: 'utf8' });
}

/** Convenience: build + serialize + append in one call. */
export function recordAuditEntry(
  input: BuildAuditEntryInput,
  options: AuditWriteOptions = {},
): AuditEntry {
  const entry = buildAuditEntry(input);
  appendAuditEntry(entry, options);
  return entry;
}
