// generate_playwright_repro (Task 3.13): turn a window of extracted user
// actions into a runnable Playwright test string. Each action maps to the
// idiomatic Playwright call:
//   navigate -> await page.goto('url')
//   click    -> await page.click('selector')
//   input    -> await page.fill('selector', 'value')
// The first navigation seeds the opening goto; subsequent navigations are
// emitted inline (e.g. an in-app route change that triggered a full load).

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
    case 'input':
      return action.selector
        ? `  await page.fill(${jsString(action.selector)}, ${jsString(action.value ?? '')});`
        : undefined;
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

  lines.push('});');
  lines.push('');
  return lines.join('\n');
}

// `expect` is imported in the generated script for the author to add assertions;
// we don't synthesize assertions in v1 (we have no oracle for "correct" state).
