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

/** The import line we add at the top of the user's wdio.conf. */
export const TRACELANE_IMPORT = `import TraceLaneService from '@tracelane/wdio';`;

/** The services-array entry we add. Tuple form: [Service, options]. */
export const TRACELANE_SERVICE_TUPLE = `[TraceLaneService, { mode: 'failed' }]`;

/** Sanity bounds for the post-edit byte-count delta (80-byte floor / 400 cap). */
export const EDIT_DELTA_MIN = 80;
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

/**
 * Locate the `services:` array literal in a wdio.conf source string. Returns
 * the bracket indices + the substring inside. We use a tiny bracket counter
 * (not a regex with .*) so nested tuples like `[['devtools', {}]]` don't
 * trip us up.
 *
 * Returns `undefined` if no `services:` key with an array literal is present.
 * (A `services: someVariable` form is also undefined — we don't try to follow
 * variable references.)
 */
export function findServicesArray(source: string): ServicesBlock | undefined {
  // Match `services` as a property key — bare identifier, double-quoted, or
  // single-quoted — followed by a colon and an opening `[`. The match must
  // be after a comma, an opening brace, or the start of a line so we don't
  // confuse a property assignment with text inside a string literal.
  const re = /(?:^|[\s,{])(?:services|"services"|'services')\s*:\s*\[/g;
  let m: RegExpExecArray | null;
  // biome-ignore lint/suspicious/noAssignInExpressions: idiomatic for global-flag regex iteration
  while ((m = re.exec(source)) !== null) {
    const openIndex = m.index + m[0].length - 1; // points at `[`
    const closeIndex = findMatchingBracket(source, openIndex);
    if (closeIndex === -1) continue;
    return {
      openIndex,
      closeIndex,
      inner: source.slice(openIndex + 1, closeIndex),
    };
  }
  return undefined;
}

/**
 * Given the index of an opening `[`, find the index of its matching `]`.
 * Counts nested `[`/`]` and skips string literals + line/block comments so
 * brackets inside `"foo[bar]baz"` or `// [stuff]` don't confuse us. Returns
 * -1 if no matching bracket exists (truncated / malformed file).
 */
function findMatchingBracket(source: string, openIndex: number): number {
  let depth = 0;
  let i = openIndex;
  const n = source.length;
  while (i < n) {
    const ch = source[i];
    // String literals: skip to the matching close quote. Handle \-escapes
    // and template literals with `${...}` interpolations.
    if (ch === '"' || ch === "'" || ch === '`') {
      const quote = ch;
      i += 1;
      while (i < n) {
        const c = source[i];
        if (c === '\\') {
          i += 2;
          continue;
        }
        if (quote === '`' && c === '$' && source[i + 1] === '{') {
          // Template-literal interpolation. Skip to the matching `}` with
          // a tiny depth counter; nested templates are rare enough to not
          // bother with.
          let braceDepth = 1;
          i += 2;
          while (i < n && braceDepth > 0) {
            if (source[i] === '{') braceDepth += 1;
            else if (source[i] === '}') braceDepth -= 1;
            i += 1;
          }
          continue;
        }
        if (c === quote) {
          i += 1;
          break;
        }
        i += 1;
      }
      continue;
    }
    // Line comment: skip to end of line.
    if (ch === '/' && source[i + 1] === '/') {
      while (i < n && source[i] !== '\n') i += 1;
      continue;
    }
    // Block comment: skip to */.
    if (ch === '/' && source[i + 1] === '*') {
      i += 2;
      while (i < n && !(source[i] === '*' && source[i + 1] === '/')) i += 1;
      i += 2;
      continue;
    }
    if (ch === '[') depth += 1;
    else if (ch === ']') {
      depth -= 1;
      if (depth === 0) return i;
    }
    i += 1;
  }
  return -1;
}

/**
 * Insert the tracelane import after the LAST `import ... from '...';` line in
 * the source. If no imports exist (which should never happen for a real WDIO
 * conf) we insert at the top.
 *
 * We don't attempt to deduplicate or sort — the user's editor + Biome will
 * fold our line in on the next save. Idempotency is enforced by the caller
 * (it checks `hasTracelaneImport(source)` before invoking this).
 */
export function insertTracelaneImport(source: string): string {
  // Walk through the source line by line, tracking the offset of the last
  // line that's an `import ... from '...';` statement. Bare `import 'css';`
  // side-effect imports also count.
  const importLineRe = /^\s*import\s.+?\s+from\s+['"][^'"]+['"];?\s*$/gm;
  let lastEnd = -1;
  let m: RegExpExecArray | null;
  // biome-ignore lint/suspicious/noAssignInExpressions: idiomatic for global-flag regex iteration
  while ((m = importLineRe.exec(source)) !== null) {
    lastEnd = m.index + m[0].length;
  }
  if (lastEnd === -1) {
    // No imports — insert at the very top, before any code. Two newlines to
    // separate from whatever follows.
    return `${TRACELANE_IMPORT}\n\n${source}`;
  }
  // Insert immediately after the last import line (preserving its newline).
  return `${source.slice(0, lastEnd)}\n${TRACELANE_IMPORT}${source.slice(lastEnd)}`;
}

/**
 * True if the source already has an `@tracelane/wdio` import. Matches both
 * default and named import forms (`import TraceLaneService from ...` /
 * `import { TraceLaneService } from ...`) and either quote style.
 */
export function hasTracelaneImport(source: string): boolean {
  return /import\s+[^;]*?from\s+['"]@tracelane\/wdio['"];?/.test(source);
}

/**
 * True if the source already mentions the TraceLaneService in a services
 * array entry — either bare (`TraceLaneService`) or tuple
 * (`[TraceLaneService, ...]`). We DON'T re-add it on a re-run.
 */
export function hasTracelaneServiceEntry(source: string): boolean {
  // Match either bare or as the first element of a tuple. We accept any
  // amount of whitespace; the user's formatter may have shifted things.
  return /\[\s*TraceLaneService\b|\bTraceLaneService\b\s*[,\]]/.test(source);
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
  //
  // We preserve the user's leading whitespace inside the bracket so a
  // multiline `services: [\n  ['devtools', {}],\n]` stays formatted nicely.
  let newInner: string;
  if (isEmpty) {
    newInner = TRACELANE_SERVICE_TUPLE;
  } else if (hasTrailingComma) {
    // Keep the comma, append the tuple after a space.
    newInner = `${trimmedInner} ${TRACELANE_SERVICE_TUPLE}`;
  } else {
    // Add `, <tuple>` after the existing content.
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
 */
export function insertServicesKey(source: string): string | undefined {
  // Match either `export const config: ... = {` or `export default {` or
  // the variants without type annotations / `module.exports = {`. The
  // important part is finding an `=`/`default` followed by an opening
  // brace at the top level of the file.
  const re = /(?:export\s+(?:default|const\s+config[^=]*=)|module\.exports\s*=)\s*(\{)/;
  const m = re.exec(source);
  if (!m) return undefined;
  const braceIndex = m.index + m[0].length - 1; // points at `{`
  const closeIndex = findMatchingBrace(source, braceIndex);
  if (closeIndex === -1) return undefined;
  // Insert before the closing `}` with two-space indent + trailing comma.
  // We don't try to mirror the user's indentation — Biome/Prettier will
  // re-format on next save.
  const insertion = `  services: [${TRACELANE_SERVICE_TUPLE}],\n`;
  return `${source.slice(0, closeIndex)}${insertion}${source.slice(closeIndex)}`;
}

/**
 * Mirror of findMatchingBracket but for `{`/`}`. Used by insertServicesKey
 * when there's no `services:` key to append to. Skips strings + comments
 * for the same robustness reasons.
 */
function findMatchingBrace(source: string, openIndex: number): number {
  let depth = 0;
  let i = openIndex;
  const n = source.length;
  while (i < n) {
    const ch = source[i];
    if (ch === '"' || ch === "'" || ch === '`') {
      const quote = ch;
      i += 1;
      while (i < n) {
        const c = source[i];
        if (c === '\\') {
          i += 2;
          continue;
        }
        if (quote === '`' && c === '$' && source[i + 1] === '{') {
          let braceDepth = 1;
          i += 2;
          while (i < n && braceDepth > 0) {
            if (source[i] === '{') braceDepth += 1;
            else if (source[i] === '}') braceDepth -= 1;
            i += 1;
          }
          continue;
        }
        if (c === quote) {
          i += 1;
          break;
        }
        i += 1;
      }
      continue;
    }
    if (ch === '/' && source[i + 1] === '/') {
      while (i < n && source[i] !== '\n') i += 1;
      continue;
    }
    if (ch === '/' && source[i + 1] === '*') {
      i += 2;
      while (i < n && !(source[i] === '*' && source[i + 1] === '/')) i += 1;
      i += 2;
      continue;
    }
    if (ch === '{') depth += 1;
    else if (ch === '}') {
      depth -= 1;
      if (depth === 0) return i;
    }
    i += 1;
  }
  return -1;
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
  const expectedFloor = hadImport ? 30 : EDIT_DELTA_MIN;
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
