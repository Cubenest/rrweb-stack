// String-based editor for playwright.config.* — the Playwright analogue of
// wdio-editor.ts (Strategy A: regex over an AST parser, for the same two
// reasons documented there: ts-morph would bloat the published CLI, and the
// space of "real" playwright.config shapes is small + well-defined).
//
// What it does (and DELIBERATELY does NOT do):
//
//   - It registers the `@tracelane/playwright` reporter in the `reporter`
//     array of the user's Playwright config — creating the array if absent,
//     appending if present, idempotent on re-run.
//   - It does NOT rewrite the user's spec files. The Playwright integration
//     also requires swapping the test import to the fixture
//     (`import { test, expect } from '@tracelane/playwright/fixture'`), which
//     can live across arbitrarily many spec files in arbitrary shapes. The
//     CLI cannot reliably rewrite all of them, so `init` registers the
//     reporter here and prints a clear, copy-pasteable follow-up instruction
//     (see FIXTURE_IMPORT_FOLLOWUP). This is the conservative choice — we
//     never touch files we can't edit safely.
//
// The contract every edit MUST satisfy after `applyPlaywrightEdit` returns
// `{ ok: true, ... }`:
//
//   - The source contains a `@tracelane/playwright` entry inside the
//     `reporter` array.
//   - File length grew by a plausible amount (sanity bound; 0 = nothing
//     happened, 10kb+ = the regex went off the rails). Idempotent re-runs
//     return `alreadyConfigured: true` and grow by 0.
//
// SHADOW SAFETY: like wdio-editor, every source-scanning regex runs against a
// `stripStringsAndComments` buffer (NOT the raw source), so a `reporter:`
// mention inside a comment or string literal can never be edited. Offsets
// translate 1:1 between the stripped and raw buffers (the strip is
// length-preserving), so a match in the stripped buffer slices out of the raw
// source by its index.

/**
 * The reporter-array entry we add. Tuple form: ['@tracelane/playwright', opts].
 * Mirrors the canonical wiring from the @tracelane/playwright README.
 */
export const TRACELANE_REPORTER_ENTRY = `['@tracelane/playwright', { mode: 'failed' }]`;

/**
 * The manual follow-up the user must apply themselves: swap the test import in
 * their spec files to tracelane's fixture. The CLI can't safely rewrite every
 * spec, so init prints this verbatim. Phrasing mirrors the README's "Use
 * tracelane's test/expect" step.
 */
export const FIXTURE_IMPORT_FOLLOWUP = `In each spec file, change your Playwright test import to tracelane's fixture
(a drop-in for @playwright/test — recording is automatic, nothing per-test):

  - import { test, expect } from '@playwright/test';
  + import { test, expect } from '@tracelane/playwright/fixture';`;

/** Sanity bounds for the post-edit byte-count delta. */
export const EDIT_DELTA_MIN = 30; // the reporter entry alone is ~45 bytes
export const EDIT_DELTA_MAX = 400;

/** A `reporter: [...]` literal block we found inside the source. */
interface ReporterBlock {
  /** Absolute character offset of the opening `[`. */
  readonly openIndex: number;
  /** Absolute character offset of the matching closing `]`. */
  readonly closeIndex: number;
  /** Substring between `[` and `]` (exclusive). */
  readonly inner: string;
}

// ---------------------------------------------------------------------------
// Shared scanner — identical strategy to wdio-editor: walk the source once,
// padding string-literal + comment bodies to spaces so regex can never match
// inside them. Offsets are preserved 1:1 (the strip is length-preserving).
// ---------------------------------------------------------------------------

/**
 * Produce a same-length copy of `src` where every string literal and every
 * comment is replaced with same-length space padding (newlines preserved).
 * Template-literal `${...}` interpolation bodies are treated as code.
 */
export function stripStringsAndComments(src: string): string {
  const out: string[] = new Array(src.length);
  let i = 0;
  const n = src.length;
  while (i < n) {
    const ch = src[i];
    const next = src[i + 1];

    // Line comment: `// ...` to end-of-line.
    if (ch === '/' && next === '/') {
      out[i] = ' ';
      out[i + 1] = ' ';
      i += 2;
      while (i < n && src[i] !== '\n') {
        out[i] = ' ';
        i += 1;
      }
      continue;
    }

    // Block comment: `/* ... */`.
    if (ch === '/' && next === '*') {
      out[i] = ' ';
      out[i + 1] = ' ';
      i += 2;
      while (i < n && !(src[i] === '*' && src[i + 1] === '/')) {
        out[i] = src[i] === '\n' ? '\n' : ' ';
        i += 1;
      }
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
      out[i] = ch;
      i += 1;
      while (i < n) {
        const c = src[i];
        if (c === '\\') {
          out[i] = ' ';
          if (i + 1 < n) out[i + 1] = src[i + 1] === '\n' ? '\n' : ' ';
          i += 2;
          continue;
        }
        if (quote === '`' && c === '$' && src[i + 1] === '{') {
          out[i] = ' ';
          out[i + 1] = ' ';
          let braceDepth = 1;
          i += 2;
          while (i < n && braceDepth > 0) {
            const cc = src[i] ?? '';
            if (cc === '{') braceDepth += 1;
            else if (cc === '}') braceDepth -= 1;
            if (braceDepth === 0) {
              out[i] = ' ';
              i += 1;
              break;
            }
            out[i] = cc;
            i += 1;
          }
          continue;
        }
        if (c === quote) {
          out[i] = c;
          i += 1;
          break;
        }
        out[i] = c === '\n' ? '\n' : ' ';
        i += 1;
      }
      continue;
    }

    out[i] = ch ?? '';
    i += 1;
  }
  return out.join('');
}

/**
 * Generic bracket/brace counter. Walks `scan` (a pre-stripped buffer) from
 * `openIndex` (which must point at an opening delimiter) and returns the index
 * of the matching closer, or -1 if EOF arrives first.
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

/** Brace + bracket combined depth at every character of a stripped buffer. */
function depthAt(scan: string): number[] {
  const out: number[] = new Array(scan.length);
  let braces = 0;
  let brackets = 0;
  for (let i = 0; i < scan.length; i += 1) {
    const ch = scan[i];
    if (ch === '{') braces += 1;
    else if (ch === '}') braces = Math.max(0, braces - 1);
    else if (ch === '[') brackets += 1;
    else if (ch === ']') brackets = Math.max(0, brackets - 1);
    out[i] = braces + brackets;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Public scanning helpers
// ---------------------------------------------------------------------------

/**
 * Locate the `reporter:` array literal in a playwright.config source string.
 * Returns the bracket indices + the substring inside, or `undefined` if the
 * `reporter` key is absent OR is not an array (e.g. `reporter: 'list'`).
 *
 * Runs against `stripStringsAndComments(source)` so a `reporter:` inside a
 * comment or string can never be selected. Prefers the SHALLOWEST brace+bracket
 * depth so a nested `reporter:` inside e.g. a `projects: [{ ... }]` entry would
 * not win over a top-level config `reporter:`.
 */
export function findReporterArray(source: string): ReporterBlock | undefined {
  const scan = stripStringsAndComments(source);
  const depths = depthAt(scan);
  // Match `reporter:` followed (after optional whitespace) by `[`. If the
  // next non-space char is NOT `[`, this isn't an array reporter and we skip.
  const re = /(?:^|[\s,{])(?:reporter|"reporter"|'reporter')\s*:\s*\[/g;
  let m: RegExpExecArray | null;
  let best: { openIndex: number; closeIndex: number; depth: number } | undefined;
  // biome-ignore lint/suspicious/noAssignInExpressions: idiomatic for global-flag regex iteration
  while ((m = re.exec(scan)) !== null) {
    const openIndex = m.index + m[0].length - 1; // points at `[`
    const closeIndex = findMatchingDelimiter(scan, openIndex, '[', ']');
    if (closeIndex === -1) continue;
    const keyDepth = depths[openIndex - 1] ?? 0;
    if (best === undefined || keyDepth < best.depth) {
      best = { openIndex, closeIndex, depth: keyDepth };
    }
  }
  if (!best) return undefined;
  return {
    openIndex: best.openIndex,
    closeIndex: best.closeIndex,
    inner: source.slice(best.openIndex + 1, best.closeIndex),
  };
}

/**
 * Slice the value region of a `reporter:` key — the array body if it's an
 * array, or the single string literal if it's a bare-string reporter. Returns
 * the RAW-source substring (offsets translate 1:1), or undefined if there's no
 * `reporter:` key outside strings/comments. This is the only place a tracelane
 * reporter entry can legitimately live, so checking ONLY this region prevents
 * a stray `"@tracelane/playwright"` string literal elsewhere in the file from
 * false-positiving.
 */
function reporterValueRegion(source: string): string | undefined {
  // Array form first.
  const block = findReporterArray(source);
  if (block !== undefined) return block.inner;
  // Bare-string form: `reporter: '...'`.
  const scan = stripStringsAndComments(source);
  const re = /(?:^|[\s,{])(?:reporter|"reporter"|'reporter')\s*:\s*(['"])/g;
  const m = re.exec(scan);
  if (!m) return undefined;
  const quoteOpen = m.index + m[0].length - 1;
  const quoteChar = source[quoteOpen];
  if (quoteChar !== "'" && quoteChar !== '"') return undefined;
  let i = quoteOpen + 1;
  while (i < source.length && source[i] !== quoteChar) i += 1;
  if (i >= source.length) return undefined;
  return source.slice(quoteOpen, i + 1);
}

/**
 * True if the source already registers the `@tracelane/playwright` reporter.
 * Only the `reporter:` value region is inspected (see `reporterValueRegion`),
 * so a `@tracelane/playwright` string literal elsewhere — or in a comment —
 * never false-positives.
 */
export function hasTracelaneReporter(source: string): boolean {
  const region = reporterValueRegion(source);
  if (region === undefined) return false;
  return /(['"])@tracelane\/playwright\1/.test(region);
}

/**
 * Append the tracelane reporter entry as the LAST element of an existing
 * reporter array. Covers:
 *
 *   reporter: []                 → reporter: [<entry>]
 *   reporter: [['list']]         → reporter: [['list'], <entry>]
 *   reporter: [['list'],]        → reporter: [['list'], <entry>]  (trailing comma)
 *
 * Caller has already located `block` via `findReporterArray`.
 */
export function appendToReporterArray(source: string, block: ReporterBlock): string {
  const inner = block.inner;
  const trimmedInner = inner.replace(/\s+$/, '');
  const isEmpty = trimmedInner.trim().length === 0;
  const hasTrailingComma = trimmedInner.endsWith(',');
  let newInner: string;
  if (isEmpty) {
    newInner = TRACELANE_REPORTER_ENTRY;
  } else if (hasTrailingComma) {
    newInner = `${trimmedInner} ${TRACELANE_REPORTER_ENTRY}`;
  } else {
    newInner = `${trimmedInner}, ${TRACELANE_REPORTER_ENTRY}`;
  }
  return `${source.slice(0, block.openIndex + 1)}${newInner}${source.slice(block.closeIndex)}`;
}

/**
 * Insert a `reporter: [<entry>]` line into a config object that has no
 * `reporter:` key at all.
 *
 * Strategy: find the FIRST config object literal — either the object passed to
 * `defineConfig({ ... })`, or an `export default { ... }` / `const config = {`
 * literal — locate its outermost `{`/`}`, and insert the reporter key just
 * after the opening brace. Returns undefined if no object literal is found
 * (caller backs out to the manual snippet).
 *
 * Runs against the stripped buffer so an example in a doc-comment can't match.
 */
export function insertReporterKey(source: string): string | undefined {
  const scan = stripStringsAndComments(source);
  // defineConfig({ ... })  |  export default { ... }  |  const config ... = {
  //  | export const config ... = {  | module.exports = {
  const re =
    /(?:defineConfig\s*\(\s*|export\s+default\s*|export\s+const\s+\w+[^=]*=\s*|const\s+\w+[^=]*=\s*|module\.exports\s*=\s*)(\{)/;
  const m = re.exec(scan);
  if (!m) return undefined;
  const braceIndex = m.index + m[0].length - 1; // points at `{`
  const closeIndex = findMatchingDelimiter(scan, braceIndex, '{', '}');
  if (closeIndex === -1) return undefined;
  // Insert right after the opening brace, on its own line, matching the
  // two-space indent typical of these configs.
  const insertion = `\n  reporter: [${TRACELANE_REPORTER_ENTRY}],`;
  return `${source.slice(0, braceIndex + 1)}${insertion}${source.slice(braceIndex + 1)}`;
}

/**
 * Promote a bare-string reporter (`reporter: 'list'`) into an array that keeps
 * the original entry and adds ours: `reporter: ['list', <entry>]`. Returns
 * undefined if no bare-string reporter is found.
 */
function promoteStringReporter(source: string): string | undefined {
  const scan = stripStringsAndComments(source);
  // `reporter:` followed by a quote (string literal), NOT a `[`.
  const re = /(?:^|[\s,{])(?:reporter|"reporter"|'reporter')\s*:\s*(['"])/g;
  const m = re.exec(scan);
  if (!m) return undefined;
  // The opening quote is at m.index + m[0].length - 1 (length-preserving).
  const quoteOpen = m.index + m[0].length - 1;
  const quoteChar = source[quoteOpen];
  if (quoteChar !== "'" && quoteChar !== '"') return undefined;
  // Find the closing quote in the RAW source.
  let i = quoteOpen + 1;
  while (i < source.length && source[i] !== quoteChar) i += 1;
  if (i >= source.length) return undefined;
  const closeQuote = i;
  const original = source.slice(quoteOpen, closeQuote + 1);
  const replacement = `[${original}, ${TRACELANE_REPORTER_ENTRY}]`;
  return `${source.slice(0, quoteOpen)}${replacement}${source.slice(closeQuote + 1)}`;
}

/** Result shape for `applyPlaywrightEdit`. */
export type PlaywrightEditResult =
  | {
      readonly ok: true;
      /** The new source content to write back. */
      readonly source: string;
      /** True if the reporter was already registered — no-op. */
      readonly alreadyConfigured: boolean;
    }
  | {
      readonly ok: false;
      /** Why the editor backed out. Surfaced verbatim to the user. */
      readonly reason: string;
      /** The snippet the user should paste manually (always populated). */
      readonly manualSnippet: string;
    };

/**
 * Manual-paste snippet shown when the editor backs out. The user adds the
 * reporter tuple to their `reporter` array themselves. Single source of truth
 * — init.ts's "restored from backup" path references this so the copy can't
 * drift.
 */
export const MANUAL_SNIPPET = `// In playwright.config.*, register the tracelane reporter:
//   reporter: [${TRACELANE_REPORTER_ENTRY}],
//
// ${FIXTURE_IMPORT_FOLLOWUP.split('\n').join('\n// ')}`;

/**
 * The single high-level entrypoint. Given the current source of a
 * playwright.config.*, produce the new source (with the tracelane reporter
 * registered) — or fail cleanly with a manual snippet.
 *
 * Steps:
 *   1. If the reporter is already registered, no-op (alreadyConfigured).
 *   2. Append to an existing `reporter: [...]` array, OR
 *   3. Promote a bare-string `reporter: 'x'` into an array, OR
 *   4. Insert a new `reporter:` key into the config object literal.
 *   5. Sanity-check the byte-count delta + presence of the marker string.
 */
export function applyPlaywrightEdit(originalSource: string): PlaywrightEditResult {
  if (hasTracelaneReporter(originalSource)) {
    return { ok: true, source: originalSource, alreadyConfigured: true };
  }

  let next: string | undefined;

  const block = findReporterArray(originalSource);
  if (block !== undefined) {
    next = appendToReporterArray(originalSource, block);
  } else {
    // No array reporter. Try promoting a bare-string reporter first; if there
    // isn't one either, insert a fresh reporter key.
    next = promoteStringReporter(originalSource) ?? insertReporterKey(originalSource);
  }

  if (next === undefined) {
    return {
      ok: false,
      reason:
        "Couldn't find a Playwright config object literal (defineConfig({...}) or export default {...}) to register the reporter into. The auto-edit was aborted — apply the snippet below manually.",
      manualSnippet: MANUAL_SNIPPET,
    };
  }

  // Sanity check: did our edit do something plausible?
  if (!hasTracelaneReporter(next)) {
    return {
      ok: false,
      reason: 'Post-edit sanity check failed: @tracelane/playwright reporter entry missing.',
      manualSnippet: MANUAL_SNIPPET,
    };
  }
  const delta = next.length - originalSource.length;
  if (delta < EDIT_DELTA_MIN || delta > EDIT_DELTA_MAX) {
    return {
      ok: false,
      reason: `Post-edit sanity check failed: byte delta ${delta} outside [${EDIT_DELTA_MIN}, ${EDIT_DELTA_MAX}] bounds.`,
      manualSnippet: MANUAL_SNIPPET,
    };
  }

  return { ok: true, source: next, alreadyConfigured: false };
}
