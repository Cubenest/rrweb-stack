// `peek audit log` (ADR-0010 / P2 PRD §H3). The native host / extension append
// one JSONL line per AI-driven act-tool call to ~/.peek/audit.log:
//   { "ts":"2026-05-23T10:14:22Z", "tool":"execute_action",
//     "args":{...}, "approvalTs":"...", "approver":"user",
//     "client":"claude-code", "sessionId":"s_8nQ…", "result":"ok" }
// This module is pure: parse + filter operate on strings/objects, so the file
// read and stdout write stay a thin shell. Malformed lines are surfaced, not
// silently dropped (an unparseable audit line is itself notable).

/** One parsed audit entry. Unknown extra fields are preserved verbatim. */
export interface AuditEntry {
  readonly ts: string;
  readonly tool?: string;
  readonly args?: unknown;
  readonly approvalTs?: string;
  readonly approver?: string;
  readonly client?: string;
  readonly sessionId?: string;
  readonly result?: string;
  readonly [extra: string]: unknown;
}

/** A line that did not parse as JSON, kept with its 1-based line number. */
export interface AuditParseError {
  readonly line: number;
  readonly raw: string;
  readonly error: string;
}

export interface ParsedAuditLog {
  readonly entries: AuditEntry[];
  readonly errors: AuditParseError[];
}

/**
 * Parse the raw JSONL contents of an audit log. Blank lines are skipped; each
 * non-blank line must be a JSON object with a string `ts`. Lines that fail to
 * parse (or aren't objects/lack `ts`) are collected in `errors` rather than
 * thrown, so a single corrupt line doesn't hide the rest of the log.
 */
export function parseAuditLog(contents: string): ParsedAuditLog {
  const entries: AuditEntry[] = [];
  const errors: AuditParseError[] = [];
  const lines = contents.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i] ?? '';
    const trimmed = raw.trim();
    if (trimmed.length === 0) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch (err) {
      errors.push({
        line: i + 1,
        raw: trimmed,
        error: err instanceof Error ? err.message : String(err),
      });
      continue;
    }
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      errors.push({ line: i + 1, raw: trimmed, error: 'not a JSON object' });
      continue;
    }
    const obj = parsed as Record<string, unknown>;
    if (typeof obj.ts !== 'string') {
      errors.push({ line: i + 1, raw: trimmed, error: 'missing string "ts"' });
      continue;
    }
    entries.push(obj as AuditEntry);
  }

  return { entries, errors };
}

export interface AuditFilter {
  /**
   * Only entries at/after this instant (epoch ms). Derived from `--since 1h`
   * via the duration parser by the command shell.
   */
  readonly sinceMs?: number;
  /** Exact `tool` match (e.g. `execute_action`). */
  readonly tool?: string;
  /** Exact `client` match (e.g. `cursor`, `claude-code`). */
  readonly client?: string;
}

/**
 * Filter parsed audit entries by `--since` / `--tool` / `--client`. An entry
 * with an unparseable `ts` is dropped only when a `sinceMs` filter is active
 * (it can't satisfy a time bound); otherwise all filters are exact-match.
 */
export function filterAuditEntries(entries: AuditEntry[], filter: AuditFilter): AuditEntry[] {
  return entries.filter((e) => {
    if (filter.tool !== undefined && e.tool !== filter.tool) return false;
    if (filter.client !== undefined && e.client !== filter.client) return false;
    if (filter.sinceMs !== undefined) {
      const tsMs = Date.parse(e.ts);
      if (Number.isNaN(tsMs) || tsMs < filter.sinceMs) return false;
    }
    return true;
  });
}
