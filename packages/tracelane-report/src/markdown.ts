// "Copy as Markdown for AI paste" payload (Task 2.12 / P1 PRD §F.3).
//
// Emits the structured prompt that is the product differentiator: failing-test
// metadata, the last 30 console messages, failed network requests, and the
// user-action log just before the failure. Built at report-build time and
// embedded as the `MARKDOWN` const the copy button writes to the clipboard.

import { EventType, IncrementalSource, MouseInteractions } from '@cubenest/rrweb-core';
import type { eventWithTime } from '@cubenest/rrweb-core';
import type { ConsoleEntry, NetworkEntry } from './panels';
import type { ReportMeta } from './types';

/** Max console messages included in the prompt (P1 PRD §F.3: "last 30"). */
export const MAX_CONSOLE_MESSAGES = 30;
/** Max user actions included in the "steps before failure" section. */
export const MAX_ACTIONS = 20;

/** One human-readable user action derived from the rrweb stream. */
export interface ActionEntry {
  description: string;
  timestamp: number;
}

interface IncrementalData {
  source?: unknown;
  type?: unknown; // MouseInteractions kind for MouseInteraction source
}
interface NavCustomData {
  tag?: unknown;
  payload?: { url?: unknown };
}

const MOUSE_INTERACTION_LABEL: Record<number, string> = {
  [MouseInteractions.Click]: 'Click',
  [MouseInteractions.DblClick]: 'Double-click',
  [MouseInteractions.ContextMenu]: 'Right-click',
  [MouseInteractions.Focus]: 'Focus',
  [MouseInteractions.Blur]: 'Blur',
  [MouseInteractions.TouchStart]: 'Touch',
  [MouseInteractions.TouchEnd]: 'Touch end',
};

/**
 * Walk the event stream for discrete user actions: meaningful mouse
 * interactions (clicks/taps/focus, not raw moves), text input, and
 * `tracelane.nav` navigation boundaries. Mouse-move / scroll noise is excluded —
 * the prompt wants the semantic steps a human or AI would narrate.
 */
export function extractActionLog(events: readonly eventWithTime[]): ActionEntry[] {
  const actions: ActionEntry[] = [];
  for (const e of events) {
    if (e.type === EventType.Custom) {
      const data = e.data as NavCustomData;
      if (data.tag === 'tracelane.nav') {
        const url = typeof data.payload?.url === 'string' ? data.payload.url : '(unknown)';
        actions.push({ description: `Navigate to ${url}`, timestamp: e.timestamp });
      }
      continue;
    }
    if (e.type !== EventType.IncrementalSnapshot) continue;
    const data = e.data as IncrementalData;
    if (data.source === IncrementalSource.MouseInteraction) {
      const kind = typeof data.type === 'number' ? data.type : -1;
      const label = MOUSE_INTERACTION_LABEL[kind];
      if (label) actions.push({ description: label, timestamp: e.timestamp });
    } else if (data.source === IncrementalSource.Input) {
      actions.push({ description: 'Input text', timestamp: e.timestamp });
    }
  }
  return actions;
}

function bullet(line: string): string {
  return `- ${line}`;
}

/** Build the Markdown prompt (P1 PRD §F.3). */
export function buildMarkdown(
  meta: ReportMeta,
  consoleRows: readonly ConsoleEntry[],
  networkRows: readonly NetworkEntry[],
  actions: readonly ActionEntry[],
): string {
  const out: string[] = [];

  out.push('## Failing test');
  out.push(bullet(`Spec: ${meta.spec ?? '(unknown)'}`));
  out.push(bullet(`Title: ${meta.title}`));
  out.push(bullet(`Status: ${meta.status}`));
  if (meta.browserName) {
    out.push(
      bullet(`Browser: ${[meta.browserName, meta.browserVersion].filter(Boolean).join(' ')}`),
    );
  }
  if (meta.commitSha) out.push(bullet(`Commit: ${meta.commitSha}`));
  if (meta.error) out.push(bullet(`Error: ${meta.error}`));
  out.push('');

  const lastConsole = consoleRows.slice(-MAX_CONSOLE_MESSAGES);
  out.push(`## Last ${lastConsole.length} console messages`);
  if (lastConsole.length === 0) {
    out.push('_None captured._');
  } else {
    for (const c of lastConsole) out.push(bullet(`[${c.level}] ${c.message}`));
  }
  out.push('');

  out.push('## Failed network requests');
  if (networkRows.length === 0) {
    out.push('_None captured._');
  } else {
    for (const n of networkRows) {
      out.push(bullet(`${n.status} ${n.method ? `${n.method} ` : ''}${n.url}`));
    }
  }
  out.push('');

  const lastActions = actions.slice(-MAX_ACTIONS);
  out.push('## Steps just before failure (rrweb action log)');
  if (lastActions.length === 0) {
    out.push('_No user actions captured._');
  } else {
    lastActions.forEach((a, i) => out.push(`${i + 1}. ${a.description}`));
  }

  return `${out.join('\n')}\n`;
}
