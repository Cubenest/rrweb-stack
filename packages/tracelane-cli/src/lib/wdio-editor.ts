// String-based editor for wdio.conf.* (Strategy A from the v0.1 spec).
//
// We chose regex over an AST parser (ts-morph) for two reasons:
//   1. ts-morph adds ~10 MB to the published @tracelane/cli — bad tradeoff
//      for a CLI whose only purpose is one transformation on first install.
//   2. The space of "real" WDIO conf shapes is small and well-defined; if
//      a user has something exotic the regex doesn't match, the editor backs
//      out cleanly and prints a manual-step snippet (the rest of `init` —
//      install, mkdir, .gitignore — still runs).
//
// The contract every edit MUST satisfy after `applyWdioEdit` returns
// `{ ok: true, ... }`:
//
//   - The source still contains `import TraceLaneService from '@tracelane/wdio';`
//     (or the existing import was already there — idempotent re-run case).
//   - The source still contains `[TraceLaneService, { mode: 'failed' }]`.
//   - File length grew by 80–200 bytes (sanity bound; 0 = nothing happened,
//     10kb+ = the regex went off the rails). Idempotent re-runs are allowed
//     to grow by 0 and return `alreadyConfigured: true`.
//
// On any sanity-check failure the caller restores the original file from the
// backup written next to the conf (`{path}.tracelane-init.backup`).
//
// SHADOW SAFETY (2026-05-29 code-review fix): every source-scanning regex
// runs against a `stripStringsAndComments` buffer, NOT the raw source. The
// strip replaces all string-literal + comment content with same-length
// space padding so offsets translate 1:1 between stripped and raw buffers
// — a match in the stripped buffer can be sliced out of the raw source by
// its index. This prevents:
//   - `/* services: ['x'] */ export const config = { services: ['real'] }`
//     from having the EXAMPLE in the comment edited and the real array
//     left untouched.
//   - `// services: ['x'] (example)` line-comment shadows.
//   - `"services: [stuff]"` string-literal shadows.
// Plus: `findServicesArray` requires the matched `services:` key to live
// at brace-depth 1 from the top-level config object literal (not inside
// `capabilities: [{ services: [...] }]`, which is a per-capability driver
// hint with different semantics).

/** The import line we add at the top of the user's wdio.conf. */
export const TRACELANE_IMPORT = `import TraceLaneService from '@tracelane/wdio';`;

/** The services-array entry we add. Tuple form: [Service, options]. */
export const TRACELANE_SERVICE_TUPLE = `[TraceLaneService, { mode: 'failed' }]`;

/**
 * Sanity bounds for the post-edit byte-count delta. The lower bound is
 * different for the "added both import + entry" path vs the "entry only
 * (idempotent import already present)" path — the import line alone is
 * already ~50 bytes, so an entry-only edit can legitimately grow by less.
 */
export const EDIT_DELTA_MIN = 80; // both import + entry added
export const EDIT_DELTA_MIN_ENTRY_ONLY = 30; // entry only — tuple is ~40 bytes
export const EDIT_DELTA_MAX = 400;

/** A `services: [...]` literal block we found inside the source. */
interface ServicesBlock {
  /** Absolute character offset of the opening `[`. */
  readonly openIndex: number;
  /** Absolute character offset of the matching closing `]`. */
  readonly closeIndex: number;
  /** Substring between `[` and `]` (exclusive). */
  readonly inner: string;
}

// ---------------------------------------------------------------------------
// Shared scanner: walk the source once, tracking string-literal state +
// line/block comments. Two consumers:
//   1. `stripStringsAndComments`: produces a same-length buffer where every
//      string-literal content and every comment body is replaced with a
//      space, so a regex run against the stripped buffer can never match
//      inside a string or comment. Offsets translate 1:1 — the index of a
//      match in the stripped buffer points at the equivalent character in
//      the raw source.
//   2. `findMatchingDelimiter`: bracket/brace counter used to find the
//      closing `]` of a `services: [` or the closing `}` of a config object.
// Both share the same string/comment skipping so the strip and the matcher
// agree on what counts as "in code" vs "in a literal".
// ---------------------------------------------------------------------------

/**
 * Produce a same-length copy of `src` where every string literal and every
 * comment is replaced with a same-length space-padded run. Newlines inside
 * line comments and block comments are preserved (so regex anchors like
 * `^...$` with the `m` flag still see the same line structure).
 *
 * Inside template literals (backtick), `${...}` interpolation BODIES are
 * treated as code — we re-enter normal mode for the interpolated expression
 * so a `services:` mention there isn't shadowed. This is rare in practice
 * (configs don't usually compute the services array via template literals)
 * but it's cheap to do right.
 */
export function stripStringsAndComments(src: string): string {
  const out: string[] = new Array(src.length);
  let i = 0;
  const n = src.length;
  while (i < n) {
    const ch = src[i];
    const next = src[i + 1];

    // Line comment: `// ...` to end-of-line. Replace the body with spaces
    // but keep newlines.
    if (ch === '/' && next === '/') {
      out[i] = ' ';
      out[i + 1] = ' ';
      i += 2;
      while (i < n && src[i] !== '\n') {
        out[i] = ' ';
        i += 1;
      }
      // The newline itself is left intact when we fall through.
      continue;
    }

    // Block comment: `/* ... */`. Replace bodies with spaces; preserve
    // newlines.
    if (ch === '/' && next === '*') {
      out[i] = ' ';
      out[i + 1] = ' ';
      i += 2;
      while (i < n && !(src[i] === '*' && src[i + 1] === '/')) {
        out[i] = src[i] === '\n' ? '\n' : ' ';
        i += 1;
      }
      // Pad the closing `*/` as well.
      if (i < n) {
        out[i] = ' ';
        out[i + 1] = ' ';
        i += 2;
      }
      continue;
    }

    // String literals: single, double, template.
    if (ch === '"' || ch === "'" || ch === '`') {
      const quote = ch;
      // Keep the opening quote so a `findServicesArray` regex anchored to
      // `^|[\s,{]` can never mistake a quote for the prelude. The CONTENT
      // is what we strip.
      out[i] = ch;
      i += 1;
      while (i < n) {
        const c = src[i];
        if (c === '\\') {
          // Pad the escape pair as two spaces. Preserve the size.
          out[i] = ' ';
          if (i + 1 < n) out[i + 1] = src[i + 1] === '\n' ? '\n' : ' ';
          i += 2;
          continue;
        }
        if (quote === '`' && c === '$' && src[i + 1] === '{') {
          // Template-literal `${...}` interpolation. The dollar-brace itself
          // is part of the literal syntax — pad it; INSIDE the braces we
          // re-enter normal "code" mode by copying the chars through. The
          // matching `}` closes the interpolation; pad it on the way out.
          out[i] = ' ';
          out[i + 1] = ' ';
          let braceDepth = 1;
          i += 2;
          while (i < n && braceDepth > 0) {
            const cc = src[i] ?? '';
            if (cc === '{') braceDepth += 1;
            else if (cc === '}') braceDepth -= 1;
            if (braceDepth === 0) {
              // Pad the closing brace.
              out[i] = ' ';
              i += 1;
              break;
            }
            // Inside the interpolation — recurse-ish: copy chars through.
            out[i] = cc;
            i += 1;
          }
          continue;
        }
        if (c === quote) {
          // Keep the closing quote for symmetry with the opener.
          out[i] = c;
          i += 1;
          break;
        }
        // Plain literal content: replace with space (or newline).
        out[i] = c === '\n' ? '\n' : ' ';
        i += 1;
      }
      continue;
    }

    // Plain code character — copy through.
    out[i] = ch ?? '';
    i += 1;
  }
  return out.join('');
}

/**
 * Generic bracket/brace counter. Walks `src` from `openIndex` (which must
 * point at an opening delimiter of the requested kind) and returns the
 * index of the matching closer, or -1 if EOF arrives first.
 *
 * We accept a pre-stripped buffer as `scan`: the bracket/brace counting
 * happens against the stripped buffer (so brackets inside strings/comments
 * are spaces and don't count) but the result is still a valid offset into
 * the original source (the strip is length-preserving).
 */
function findMatchingDelimiter(
  scan: string,
  openIndex: number,
  open: '[' | '{',
  close: ']' | '}',
): number {
  let depth = 0;
  let i = openIndex;
  const n = scan.length;
  while (i < n) {
    const ch = scan[i];
    if (ch === open) depth += 1;
    else if (ch === close) {
      depth -= 1;
      if (depth === 0) return i;
    }
    i += 1;
  }
  return -1;
}

/**
 * Compute the brace-depth (count of unmatched `{` minus `}`) at every
 * character position in a pre-stripped buffer. Used by `findServicesArray`
 * to reject matches inside nested objects like
 *   capabilities: [{ services: ['safari'] }]
 * — the inner `services` lives at brace-depth 3 (config → capabilities-array
 * tuple → inner object), while the OUTER `services` of the testrunner is at
 * depth 1 (directly inside the config object). We prefer the shallowest
 * match.
 *
 * Bracket nesting `[` is also tracked because `services:` inside
 * `capabilities: [...]` is in a deeper bracket scope even if its brace depth
 * happens to match in some shape. We sum brace+bracket depth for the
 * "is this directly in the config object" check.
 */
interface DepthInfo {
  /** Brace + bracket combined depth at this character. */
  readonly depth: number;
}

function depthAt(scan: string): DepthInfo[] {
  const out: DepthInfo[] = new Array(scan.length);
  let braces = 0;
  let brackets = 0;
  for (let i = 0; i < scan.length; i += 1) {
    const ch = scan[i];
    if (ch === '{') braces += 1;
    else if (ch === '}') braces = Math.max(0, braces - 1);
    else if (ch === '[') brackets += 1;
    else if (ch === ']') brackets = Math.max(0, brackets - 1);
    out[i] = { depth: braces + brackets };
  }
  return out;
}

// ---------------------------------------------------------------------------
// Public scanning helpers
// ---------------------------------------------------------------------------

/**
 * Locate the `services:` array literal in a wdio.conf source string. Returns
 * the bracket indices + the substring inside.
 *
 * The match runs against `stripStringsAndComments(source)` so a `services:`
 * inside a comment or a string can never be selected. Among the remaining
 * candidates, we prefer the SHALLOWEST brace+bracket depth — this rejects
 * `capabilities: [{ services: ['safari'] }]` (depth 3) in favour of the
 * outer testrunner `services:` (depth 1). The depth-1 preference matches
 * the WDIO config schema (services live directly on the config object).
 *
 * Returns `undefined` if no `services:` key with an array literal is present
 * outside strings/comments.
 */
export function findServicesArray(source: string): ServicesBlock | undefined {
  const scan = stripStringsAndComments(source);
  const depths = depthAt(scan);
  const re = /(?:^|[\s,{])(?:services|"services"|'services')\s*:\s*\[/g;
  let m: RegExpExecArray | null;
  let best: { openIndex: number; closeIndex: number; depth: number } | undefined;
  // biome-ignore lint/suspicious/noAssignInExpressions: idiomatic for global-flag regex iteration
  while ((m = re.exec(scan)) !== null) {
    const openIndex = m.index + m[0].length - 1; // points at `[`
    const closeIndex = findMatchingDelimiter(scan, openIndex, '[', ']');
    if (closeIndex === -1) continue;
    // Depth at the character JUST BEFORE the `[` — that's the depth at
    // which the `services:` key was declared. (After we pass the `[` itself
    // we're one bracket deeper, but the key's scope is the surrounding
    // object.)
    const keyDepth = depths[openIndex - 1]?.depth ?? 0;
    if (best === undefined || keyDepth < best.depth) {
      best = { openIndex, closeIndex, depth: keyDepth };
    }
  }
  if (!best) return undefined;
  return {
    openIndex: best.openIndex,
    closeIndex: best.closeIndex,
    // Slice the inner content out of the ORIGINAL source (strip is length-
    // preserving so indices match), so the user's actual array contents
    // are what gets edited.
    inner: source.slice(best.openIndex + 1, best.closeIndex),
  };
}

/**
 * Insert the tracelane import after the LAST `import ... from '...';` line in
 * the source. If no imports exist (which should never happen for a real WDIO
 * conf) we insert at the top.
 *
 * We don't attempt to deduplicate or sort — the user's editor + Biome will
 * fold our line in on the next save. Idempotency is enforced by the caller
 * (it checks `hasTracelaneImport(source)` before invoking this).
 *
 * Match runs against the stripped buffer so a top-of-file block comment
 * mentioning `import` cannot shadow the real import section.
 */
export function insertTracelaneImport(source: string): string {
  const scan = stripStringsAndComments(source);
  const importLineRe = /^\s*import\s.+?\s+from\s+['"][^'"]+['"];?\s*$/gm;
  let lastEnd = -1;
  let m: RegExpExecArray | null;
  // biome-ignore lint/suspicious/noAssignInExpressions: idiomatic for global-flag regex iteration
  while ((m = importLineRe.exec(scan)) !== null) {
    lastEnd = m.index + m[0].length;
  }
  if (lastEnd === -1) {
    // No imports — insert at the very top, before any code.
    return `${TRACELANE_IMPORT}\n\n${source}`;
  }
  // Insert immediately after the last import line. Index is into the raw
  // source because the strip is length-preserving.
  return `${source.slice(0, lastEnd)}\n${TRACELANE_IMPORT}${source.slice(lastEnd)}`;
}

/**
 * True if the source already has an `@tracelane/wdio` import. Matches both
 * default and named import forms (`import TraceLaneService from ...` /
 * `import { TraceLaneService } from ...`) and either quote style. Runs
 * against the stripped buffer so a commented-out example
 *   // import TraceLaneService from '@tracelane/wdio';
 * doesn't false-positive — but the stripped buffer preserves the import
 * keyword itself, so a real import is still detected.
 *
 * Wait — we DO want to match the literal '@tracelane/wdio' inside the
 * `from '...'` clause. The strip replaces string CONTENT with spaces, so
 * `from '@tracelane/wdio'` becomes `from '              '` in the stripped
 * buffer. We need to recognise the real import by structure: the keyword
 * `import`, the binding, `from`, a string literal of any contents. We test
 * the structural shape on the stripped buffer, then verify the string
 * literal's contents against the RAW source at the matched offsets.
 */
export function hasTracelaneImport(source: string): boolean {
  const scan = stripStringsAndComments(source);
  // Structural match against the stripped buffer (the string contents are
  // padded out to spaces but the surrounding `from '...'` syntax stays).
  const re = /import\s+[^;]*?from\s+(['"])([^'"]*)\1;?/g;
  let m: RegExpExecArray | null;
  // biome-ignore lint/suspicious/noAssignInExpressions: idiomatic for global-flag regex iteration
  while ((m = re.exec(scan)) !== null) {
    // The group at index 2 is the STRING CONTENT in the stripped buffer (so
    // spaces), but the same offsets in the RAW source carry the real chars.
    const fullMatchStart = m.index;
    const fullMatchEnd = m.index + m[0].length;
    const raw = source.slice(fullMatchStart, fullMatchEnd);
    if (/from\s+['"]@tracelane\/wdio['"]/.test(raw)) return true;
  }
  return false;
}

/**
 * True if the source already mentions the TraceLaneService in a services
 * array entry — either bare (`TraceLaneService`) or tuple
 * (`[TraceLaneService, ...]`). Runs against the stripped buffer to ignore
 * comment + string mentions.
 */
export function hasTracelaneServiceEntry(source: string): boolean {
  const scan = stripStringsAndComments(source);
  return /\[\s*TraceLaneService\b|\bTraceLaneService\b\s*[,\]]/.test(scan);
}

/**
 * Insert `[TraceLaneService, { mode: 'failed' }]` as the LAST element of an
 * existing services array. Three input shapes covered:
 *
 *   services: []                  → services: [[Service, opts]]
 *   services: ['devtools']        → services: ['devtools', [Service, opts]]
 *   services: [['devtools', {}]]  → services: [['devtools', {}], [Service, opts]]
 *
 * Returns the new full source. Caller has already located `block` via
 * `findServicesArray`.
 */
export function appendToServicesArray(source: string, block: ServicesBlock): string {
  const inner = block.inner;
  const trimmedInner = inner.replace(/\s+$/, '');
  const isEmpty = trimmedInner.trim().length === 0;
  // Detect trailing comma so we don't double-comma.
  const hasTrailingComma = trimmedInner.endsWith(',');
  // Replacement strategy: rebuild the inner content with our entry appended.
  //
  // - Empty array  → `[<tuple>]`
  // - Trailing ,   → `[existing, <tuple>]`  (we add tuple after the comma)
  // - No trailing  → `[existing, <tuple>]`  (we add `, <tuple>`)
  let newInner: string;
  if (isEmpty) {
    newInner = TRACELANE_SERVICE_TUPLE;
  } else if (hasTrailingComma) {
    newInner = `${trimmedInner} ${TRACELANE_SERVICE_TUPLE}`;
  } else {
    newInner = `${trimmedInner}, ${TRACELANE_SERVICE_TUPLE}`;
  }
  return `${source.slice(0, block.openIndex + 1)}${newInner}${source.slice(block.closeIndex)}`;
}

/**
 * Insert a `services: [[TraceLaneService, ...]]` line into a config object
 * that has no `services:` key at all.
 *
 * Strategy: find the FIRST top-level `export const config` / `export default`
 * config object literal, locate its outermost `{`/`}`, and insert
 *   services: [[TraceLaneService, { mode: 'failed' }]],
 * just before the closing `}`. If we can't find the object literal, return
 * undefined and let the caller back out to the manual-snippet path.
 *
 * Runs against the stripped buffer so an `export default { ... }` string in
 * a doc-comment header can't be matched.
 */
export function insertServicesKey(source: string): string | undefined {
  const scan = stripStringsAndComments(source);
  const re = /(?:export\s+(?:default|const\s+config[^=]*=)|module\.exports\s*=)\s*(\{)/;
  const m = re.exec(scan);
  if (!m) return undefined;
  const braceIndex = m.index + m[0].length - 1; // points at `{`
  const closeIndex = findMatchingDelimiter(scan, braceIndex, '{', '}');
  if (closeIndex === -1) return undefined;
  const insertion = `  services: [${TRACELANE_SERVICE_TUPLE}],\n`;
  return `${source.slice(0, closeIndex)}${insertion}${source.slice(closeIndex)}`;
}

/** Result shape for `applyWdioEdit`. */
export type WdioEditResult =
  | {
      readonly ok: true;
      /** The new source content to write back. */
      readonly source: string;
      /** True if the source already had the import + service entry — no-op. */
      readonly alreadyConfigured: boolean;
      /** True if we ADDED the import (false on idempotent re-run). */
      readonly addedImport: boolean;
      /** True if we ADDED the service-array entry. */
      readonly addedServiceEntry: boolean;
    }
  | {
      readonly ok: false;
      /** The reason the editor backed out. Surfaced verbatim to the user. */
      readonly reason: string;
      /** The snippet the user should paste manually (always populated). */
      readonly manualSnippet: string;
    };

/**
 * Manual-paste snippet shown when the editor backs out. The user pastes this
 * at the top of their conf and adds the tuple to `services:` themselves.
 *
 * This is the single source of truth — `init.ts`'s "restored from backup"
 * path also references this constant so the snippet copy doesn't drift.
 */
export const MANUAL_SNIPPET = `${TRACELANE_IMPORT}

// Inside your config object's \`services\` array:
//   services: [${TRACELANE_SERVICE_TUPLE}],
`;

/**
 * The single high-level entrypoint. Given the current source of a
 * wdio.conf.*, produce the new source (with the import + service tuple
 * added) — or fail cleanly with a manual snippet for the user to paste.
 *
 * Steps:
 *   1. If both the import + the service entry are already present, no-op.
 *   2. Add the import if it's missing.
 *   3. Append to the existing `services: [...]` array, OR insert a new
 *      `services:` key if none exists.
 *   4. Sanity-check the byte-count delta + presence of the marker strings.
 *
 * The sanity check at the END is the safety net: if our regex went off the
 * rails (e.g. landed on an unusual shape) the delta is wildly wrong and we
 * back out instead of writing a corrupt file.
 */
export function applyWdioEdit(originalSource: string): WdioEditResult {
  const hadImport = hasTracelaneImport(originalSource);
  const hadEntry = hasTracelaneServiceEntry(originalSource);

  // Idempotent re-run: both pieces present, nothing to do.
  if (hadImport && hadEntry) {
    return {
      ok: true,
      source: originalSource,
      alreadyConfigured: true,
      addedImport: false,
      addedServiceEntry: false,
    };
  }

  let next = originalSource;
  if (!hadImport) {
    next = insertTracelaneImport(next);
  }

  let addedEntry = false;
  if (!hadEntry) {
    const block = findServicesArray(next);
    if (block !== undefined) {
      next = appendToServicesArray(next, block);
      addedEntry = true;
    } else {
      // No `services:` key at all — try to insert one inside the config object.
      const withKey = insertServicesKey(next);
      if (withKey === undefined) {
        return {
          ok: false,
          reason:
            "Couldn't find the WDIO config object's `services:` array or a config object literal in the conf file. The auto-edit was aborted — apply the snippet below manually.",
          manualSnippet: MANUAL_SNIPPET,
        };
      }
      next = withKey;
      addedEntry = true;
    }
  }

  // Sanity check: did our edit do something plausible?
  if (!hasTracelaneImport(next)) {
    return {
      ok: false,
      reason: 'Post-edit sanity check failed: import line missing.',
      manualSnippet: MANUAL_SNIPPET,
    };
  }
  if (!hasTracelaneServiceEntry(next)) {
    return {
      ok: false,
      reason: 'Post-edit sanity check failed: TraceLaneService entry missing.',
      manualSnippet: MANUAL_SNIPPET,
    };
  }
  const delta = next.length - originalSource.length;
  // If both import + entry were ADDED we expect ~80-200 bytes of growth.
  // If ONLY the entry was added (import was already there) the floor is
  // smaller — the tuple itself is ~40 bytes.
  const expectedFloor = hadImport ? EDIT_DELTA_MIN_ENTRY_ONLY : EDIT_DELTA_MIN;
  if (delta < expectedFloor || delta > EDIT_DELTA_MAX) {
    return {
      ok: false,
      reason: `Post-edit sanity check failed: byte delta ${delta} outside [${expectedFloor}, ${EDIT_DELTA_MAX}] bounds.`,
      manualSnippet: MANUAL_SNIPPET,
    };
  }

  return {
    ok: true,
    source: next,
    alreadyConfigured: false,
    addedImport: !hadImport,
    addedServiceEntry: addedEntry,
  };
}
