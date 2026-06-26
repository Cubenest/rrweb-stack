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

import { appendFileSync, existsSync, mkdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { peekHomeDir } from '../db/open.js';
import { type Action, redactActionForAudit } from '../mcp/action-schema.js';
import { LOCK_GAP_PREV, hashLine } from './audit-chain.js';
import {
  type AuditHead,
  auditHeadPath,
  auditLockPath,
  initHead,
  logIsChained,
  readHead,
  rebuildHeadFromLog,
  writeHeadAtomic,
} from './audit-head.js';
import { type LockOptions, withFileLock } from './file-lock.js';

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

/**
 * A draft audit entry — everything {@link buildAuditEntry} produces, BEFORE the
 * writer stamps the hash-chain fields (`seq`, `prevHash`). Pure to construct.
 */
export interface DraftAuditEntry {
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

/**
 * A single chained audit entry as it lands on disk — a {@link DraftAuditEntry}
 * plus the hash-chain fields the writer stamps under the file lock. Matches the
 * CLI's AuditEntry interface.
 */
export interface AuditEntry extends DraftAuditEntry {
  /** 1-based position of this line in the chained region (after any prefix). */
  seq: number;
  /** hashLine() of the previous chained line, GENESIS_PREV for seq 1, or
   * LOCK_GAP_PREV when written without the lock (chain gap). */
  prevHash: string;
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
export function buildAuditEntry(input: BuildAuditEntryInput): DraftAuditEntry {
  const ts = new Date(input.nowMs ?? Date.now()).toISOString();
  const entry: DraftAuditEntry = {
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
  /** Lock tuning for the chained append (tests use a short maxWaitMs). */
  readonly lock?: LockOptions;
}

/** Ensure the log file's parent dir exists + seed an empty 0o600 file. */
function ensureLogFile(logPath: string): void {
  mkdirSync(dirname(logPath), { recursive: true });
  if (!existsSync(logPath)) {
    writeFileSync(logPath, '', { mode: 0o600 });
  }
}

/**
 * Resolve the head for an append. Prefers the on-disk head. If it's missing or
 * corrupt we must NOT blindly `initHead`, which seals the whole log as a legacy
 * `prefix` and restarts the chain — when the log already has chained entries
 * that destroys their per-entry tamper-evidence. So: if the log is already
 * chained, rebuild the head from its real tail (prefix stays null); only seal a
 * genuinely-legacy (unchained) log as a prefix.
 */
function loadHead(logPath: string, headPath: string): AuditHead {
  const existing = readHead(headPath);
  if (existing) return existing;
  return logIsChained(logPath) ? rebuildHeadFromLog(logPath, null) : initHead(logPath);
}

/**
 * Append ONE chained line under the file lock. Reads (or initialises) the head,
 * self-heals it if the on-disk size has drifted, stamps `seq`/`prevHash`,
 * appends the line, then atomically advances the head to point at the new tail.
 */
function chainAppend(draft: DraftAuditEntry, logPath: string, headPath: string): AuditEntry {
  let head = loadHead(logPath, headPath);
  // Size-drift self-heal: if the log grew/shrank since the head was written
  // (e.g. a prior gap-append, an external edit, a crash), re-derive the tail.
  const onDisk = existsSync(logPath) ? statSync(logPath).size : 0;
  if (onDisk !== head.bytes) head = rebuildHeadFromLog(logPath, head.prefix);

  const entry: AuditEntry = { ...draft, seq: head.seq + 1, prevHash: head.headHash };
  ensureLogFile(logPath);
  const line = serializeAuditEntry(entry);
  appendFileSync(logPath, line, { encoding: 'utf8' });
  const thisHash = hashLine(line);
  writeHeadAtomic(headPath, {
    version: 1,
    prefix: head.prefix,
    seq: entry.seq,
    headHash: thisHash,
    gapCount: head.gapCount,
    bytes: statSync(logPath).size,
    updatedAt: entry.ts,
  });
  return entry;
}

/**
 * Best-effort append when the lock could NOT be acquired. The line is NEVER
 * dropped: we write it with the LOCK_GAP_PREV sentinel so verify flags the gap,
 * and (best-effort) bump the head's gapCount. We hold NO lock here, so the head
 * write is wrapped in try/catch — the next successful locked write self-heals
 * via the size-drift check.
 */
function gapAppend(draft: DraftAuditEntry, logPath: string, headPath: string): AuditEntry {
  // This path runs WITHOUT the lock (we couldn't acquire it), so two concurrent
  // appends could in principle interleave. That's bounded by the single-`write`
  // atomicity the OS gives regular-file appends (this is NOT a PIPE_BUF-limited
  // pipe), and even a torn line would land inside an already-gap-flagged region
  // that `verify` flags — so the worst case is a detectable gap, not silent
  // corruption. The trade-off is deliberate: we never drop an audit line.
  const head = loadHead(logPath, headPath);
  // `seq` here is advisory: the head was read without the lock, so this seq may
  // collide with a concurrent locked write across the LOCK_GAP_PREV boundary.
  // Chain linkage via `prevHash` is the authoritative ordering — a verifier MUST
  // NOT assert strict `seq` monotonicity across gap (LOCK_GAP_PREV) lines.
  const entry: AuditEntry = { ...draft, seq: head.seq + 1, prevHash: LOCK_GAP_PREV };
  ensureLogFile(logPath);
  const line = serializeAuditEntry(entry);
  appendFileSync(logPath, line, { encoding: 'utf8' });
  try {
    writeHeadAtomic(headPath, {
      version: 1,
      prefix: head.prefix,
      seq: entry.seq,
      headHash: hashLine(line),
      gapCount: head.gapCount + 1,
      bytes: statSync(logPath).size,
      updatedAt: entry.ts,
    });
  } catch {
    /* best-effort; the next locked write self-heals the head */
  }
  return entry;
}

/**
 * Append a chained entry to the audit log, ensuring `~/.peek` exists first.
 * Returns the full chained entry (`seq` + `prevHash` stamped). Throws on I/O
 * failure — the host's caller catches + downgrades to a console.error so a
 * write-failure can't tear down an action request mid-flight, but the throw is
 * propagated so tests can assert on it.
 *
 * Concurrency: the chained append runs under an O_EXCL file lock so two hosts
 * can't interleave a `seq`/`prevHash` read-modify-write. If the lock can't be
 * acquired within `maxWaitMs`, we fall back to a best-effort {@link gapAppend}
 * so a line is NEVER dropped — the trust surface must not lose entries.
 *
 * The audit log contains URL paths, DOM selectors, MCP-client identity, and
 * session IDs. On a multi-user POSIX system we want owner-only access, so on
 * first write we seed the file with mode `0o600`. If the file already exists
 * we don't touch its mode — the user may have set their own. Windows ignores
 * the `mode` argument silently; that's acceptable here.
 */
export function appendAuditEntry(
  draft: DraftAuditEntry,
  options: AuditWriteOptions = {},
): AuditEntry {
  const logPath = options.path ?? auditLogPath();
  const headPath = auditHeadPath(logPath);
  const lockPath = auditLockPath(logPath);
  // The lock file is a sibling of the log, so its parent dir must exist before
  // we can O_EXCL-create it — make `~/.peek` (or the test dir) up front.
  mkdirSync(dirname(logPath), { recursive: true });
  try {
    return withFileLock(lockPath, () => chainAppend(draft, logPath, headPath), options.lock);
  } catch (err) {
    // Lock could not be acquired in time → never drop the line.
    if (err instanceof Error && /lock timeout/i.test(err.message)) {
      return gapAppend(draft, logPath, headPath);
    }
    throw err;
  }
}

/** Convenience: build + chain + append in one call. */
export function recordAuditEntry(
  input: BuildAuditEntryInput,
  options: AuditWriteOptions = {},
): AuditEntry {
  return appendAuditEntry(buildAuditEntry(input), options);
}
