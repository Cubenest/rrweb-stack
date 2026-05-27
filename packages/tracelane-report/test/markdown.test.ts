import { EventType, IncrementalSource, MouseInteractions } from '@cubenest/rrweb-core';
import type { eventWithTime } from '@cubenest/rrweb-core';
import { describe, expect, it } from 'vitest';
import { MAX_CONSOLE_MESSAGES, buildMarkdown, extractActionLog } from '../src/markdown';
import type { ConsoleEntry, NetworkEntry } from '../src/panels';
import type { ReportMeta } from '../src/types';

const META: ReportMeta = {
  spec: 'test/login.spec.ts',
  title: 'logs in',
  status: 'failed',
  error: 'expected dashboard',
  browserName: 'chrome',
  browserVersion: '124.0',
  commitSha: 'abc1234',
};

function inc(source: number, extra: Record<string, unknown>, timestamp: number): eventWithTime {
  return {
    type: EventType.IncrementalSnapshot,
    data: { source, ...extra },
    timestamp,
  } as unknown as eventWithTime;
}

describe('extractActionLog (Task 2.12)', () => {
  it('captures clicks, input, and tracelane.nav boundaries in order', () => {
    const events: eventWithTime[] = [
      inc(IncrementalSource.MouseInteraction, { type: MouseInteractions.Click, id: 1 }, 10),
      inc(IncrementalSource.Input, { id: 2, text: 'hi' }, 20),
      {
        type: EventType.Custom,
        data: { tag: 'tracelane.nav', payload: { url: 'http://app/next' } },
        timestamp: 30,
      } as unknown as eventWithTime,
    ];
    expect(extractActionLog(events)).toEqual([
      { description: 'Click', timestamp: 10 },
      { description: 'Input text', timestamp: 20 },
      { description: 'Navigate to http://app/next', timestamp: 30 },
    ]);
  });

  it('excludes mouse-move / scroll noise', () => {
    const events: eventWithTime[] = [
      inc(IncrementalSource.MouseMove, { positions: [] }, 1),
      inc(IncrementalSource.Scroll, { id: 1, x: 0, y: 100 }, 2),
      inc(IncrementalSource.MouseInteraction, { type: MouseInteractions.Click, id: 1 }, 3),
    ];
    expect(extractActionLog(events)).toEqual([{ description: 'Click', timestamp: 3 }]);
  });

  it('labels distinct mouse-interaction kinds and ignores non-action kinds', () => {
    const events: eventWithTime[] = [
      inc(IncrementalSource.MouseInteraction, { type: MouseInteractions.DblClick, id: 1 }, 1),
      inc(IncrementalSource.MouseInteraction, { type: MouseInteractions.ContextMenu, id: 1 }, 2),
      // MouseUp/MouseDown are not narratable steps -> excluded.
      inc(IncrementalSource.MouseInteraction, { type: MouseInteractions.MouseDown, id: 1 }, 3),
    ];
    expect(extractActionLog(events).map((a) => a.description)).toEqual([
      'Double-click',
      'Right-click',
    ]);
  });
});

describe('buildMarkdown (Task 2.12 / P1 PRD §F.3)', () => {
  const consoleRows: ConsoleEntry[] = [
    { level: 'log', message: 'clicked submit', timestamp: 1 },
    { level: 'error', message: 'Login failed: 401', timestamp: 2 },
  ];
  const networkRows: NetworkEntry[] = [
    { method: 'GET', url: 'https://api/me', status: 404, timestamp: 3 },
  ];
  const actions = [
    { description: 'Click', timestamp: 1 },
    { description: 'Navigate to http://app/x', timestamp: 2 },
  ];

  it('emits the four PRD sections in order', () => {
    const md = buildMarkdown(META, consoleRows, networkRows, actions);
    const failing = md.indexOf('## Failing test');
    const console = md.indexOf('## Last 2 console messages');
    const network = md.indexOf('## Failed network requests');
    const steps = md.indexOf('## Steps just before failure (rrweb action log)');
    expect(failing).toBeGreaterThanOrEqual(0);
    expect(console).toBeGreaterThan(failing);
    expect(network).toBeGreaterThan(console);
    expect(steps).toBeGreaterThan(network);
  });

  it('includes the failing-test metadata', () => {
    const md = buildMarkdown(META, consoleRows, networkRows, actions);
    expect(md).toContain('- Spec: test/login.spec.ts');
    expect(md).toContain('- Title: logs in');
    expect(md).toContain('- Status: failed');
    expect(md).toContain('- Browser: chrome 124.0');
    expect(md).toContain('- Commit: abc1234');
    expect(md).toContain('- Error: expected dashboard');
  });

  it('lists console messages with level and failed network requests', () => {
    const md = buildMarkdown(META, consoleRows, networkRows, actions);
    expect(md).toContain('- [log] clicked submit');
    expect(md).toContain('- [error] Login failed: 401');
    expect(md).toContain('- 404 GET https://api/me');
  });

  it('numbers the action steps', () => {
    const md = buildMarkdown(META, consoleRows, networkRows, actions);
    expect(md).toContain('1. Click');
    expect(md).toContain('2. Navigate to http://app/x');
  });

  it('caps the console section at the last 30 messages', () => {
    const many: ConsoleEntry[] = Array.from({ length: 50 }, (_, i) => ({
      level: 'log',
      message: `msg-${i}`,
      timestamp: i,
    }));
    const md = buildMarkdown(META, many, [], []);
    expect(md).toContain(`## Last ${MAX_CONSOLE_MESSAGES} console messages`);
    expect(md).toContain('msg-49'); // newest kept
    expect(md).not.toContain('msg-19'); // older than the last 30 dropped
    expect(md).toContain('msg-20'); // boundary kept
  });

  it('renders explicit empty-state placeholders', () => {
    const md = buildMarkdown(META, [], [], []);
    expect(md).toContain('## Last 0 console messages');
    expect(md).toContain('_None captured._');
    expect(md).toContain('_No user actions captured._');
  });
});
