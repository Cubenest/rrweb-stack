// generate_playwright_repro (Task 3.13): turn a window of extracted user
// actions into a runnable Playwright test string. Each action maps to the
// idiomatic Playwright call:
//   navigate          -> await page.goto('url')
//   click             -> await page.click('selector')
//   input (select)    -> await page.selectOption('selector', 'value')
//   input (checkbox/radio) -> await page.check/uncheck('selector')
//   input (other)     -> await page.fill('selector', 'value')
// The first navigation seeds the opening goto; subsequent navigations are
// emitted inline (e.g. an in-app route change that triggered a full load).
// After the actions, a final `await expect(page).toHaveURL(...)` is emitted
// for the last navigation so the repro verifies the end state, not just replays.

import type { UserAction } from './event-walker.js';
import { extractUserActions } from './event-walker.js';
import type { eventWithTime } from './rrweb-types.js';

export interface GenerateReproOptions {
  /** Only include actions at/after this epoch-millis. */
  readonly startTs?: number;
  /** Only include actions at/before this epoch-millis. */
  readonly endTs?: number;
  /** Test title (defaults to a session-derived label). */
  readonly title?: string;
  /** Max actions to emit (default 200); keeps the latest N, the rest noted. */
  readonly maxActions?: number;
}

/** Default ceiling on emitted actions — caps the output size (PRD §B token budget). */
const DEFAULT_MAX_ACTIONS = 200;

/** Single-quote-escape a value for embedding in a generated JS string literal. */
function jsString(value: string): string {
  // Order matters: backslash first, then quote, then the line terminators —
  // a bare \r or \n in a single-quoted literal is a strict-mode syntax error.
  return `'${value
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')}'`;
}

/** Map one user action to a Playwright statement, or undefined to skip it. */
function actionToStatement(action: UserAction): string | undefined {
  switch (action.type) {
    case 'navigate':
      return action.url ? `  await page.goto(${jsString(action.url)});` : undefined;
    case 'click':
      return action.selector ? `  await page.click(${jsString(action.selector)});` : undefined;
    case 'input': {
      if (!action.selector) return undefined;
      const sel = jsString(action.selector);
      if (action.elementTag === 'input') {
        if (action.inputType === 'checkbox' || action.inputType === 'radio') {
          if (action.checked === true) return `  await page.check(${sel});`;
          if (action.checked === false) return `  await page.uncheck(${sel});`;
          return `  // TODO: <input type="${action.inputType}"> ${action.selector} — checked state unknown; add check()/uncheck()`;
        }
        if (
          action.inputType === 'hidden' ||
          action.inputType === 'submit' ||
          action.inputType === 'button' ||
          action.inputType === 'reset' ||
          action.inputType === 'image'
        ) {
          return `  // TODO: skipped <input type="${action.inputType}"> (not a user text entry)`;
        }
        if (action.inputType === 'file') {
          return `  // TODO: file input ${action.selector} — setInputFiles can't be reconstructed from a recording`;
        }
      }
      if (action.elementTag === 'select') {
        // rrweb captures only a single text value per input event, so only
        // single-value <select> interactions are representable here. A
        // <select multiple> repro would be incorrect (only one option captured);
        // no multi-select detection is attempted — this is a known v1 limitation.
        const value = action.value ?? '';
        // I1: an empty value would make Playwright throw at runtime
        // ("did not find some options"). Emit a TODO so the script stays runnable.
        if (value === '')
          return '  // TODO: <select> reset to placeholder — selectOption needs a value or { index: 0 }';
        return `  await page.selectOption(${jsString(action.selector)}, ${jsString(value)});`;
      }
      return `  await page.fill(${jsString(action.selector)}, ${jsString(action.value ?? '')});`;
    }
    default:
      return undefined;
  }
}

/**
 * Build a Playwright `test(...)` script from the user actions within
 * `[startTs, endTs]`. Actions whose target selector couldn't be resolved are
 * emitted as a `// TODO` comment (so the script stays runnable and the gap is
 * visible) rather than silently dropped.
 */
export function generatePlaywrightRepro(
  events: eventWithTime[],
  options: GenerateReproOptions = {},
): string {
  const startTs = options.startTs ?? Number.NEGATIVE_INFINITY;
  const endTs = options.endTs ?? Number.POSITIVE_INFINITY;
  const title = options.title ?? 'peek recorded session';
  const maxActions = options.maxActions ?? DEFAULT_MAX_ACTIONS;

  const allInWindow = extractUserActions(events).filter((a) => a.ts >= startTs && a.ts <= endTs);
  // Cap output: keep the LATEST N actions (most relevant to reproduce recent
  // behavior), noting the truncation so the agent knows the repro is partial.
  const truncated = allInWindow.length > maxActions;
  const actions = truncated ? allInWindow.slice(allInWindow.length - maxActions) : allInWindow;

  const lines: string[] = [];
  lines.push(`import { test, expect } from '@playwright/test';`);
  lines.push('');
  lines.push(`test(${jsString(title)}, async ({ page }) => {`);

  if (actions.length === 0) {
    lines.push('  // No user actions were recorded in this window.');
  } else if (truncated) {
    lines.push(
      `  // truncated: showing last ${maxActions} of ${allInWindow.length} actions (narrow startTs/endTs for the rest)`,
    );
  }

  for (const action of actions) {
    const stmt = actionToStatement(action);
    if (stmt !== undefined) {
      lines.push(stmt);
    } else {
      lines.push(`  // TODO: ${action.summary} (target selector unresolved)`);
    }
  }

  // T0.5: assert the end state. Find the last navigate (with a url) in the
  // capped window and verify the page landed there — turning a blind replay
  // into a test with a real oracle for the final URL.
  for (let i = actions.length - 1; i >= 0; i -= 1) {
    const a = actions[i];
    if (a && a.type === 'navigate' && a.url) {
      lines.push(`  await expect(page).toHaveURL(${jsString(a.url)});`);
      break;
    }
  }

  lines.push('});');
  lines.push('');
  return lines.join('\n');
}

// `expect` is used for the final-URL assertion above (the one oracle we can
// derive from a recording). We don't synthesize other assertions — we have no
// ground truth for "correct" intermediate state — so the author still adds
// content/visibility checks as needed.
