import { EventType } from '@cubenest/rrweb-core';
import type { eventWithTime } from '@cubenest/rrweb-core';
import { describe, expect, it } from 'vitest';
import {
  CONSOLE_PLUGIN,
  NETWORK_CONSOLE_PREFIX,
  NETWORK_EVENT_TAG,
  extractConsole,
  extractNetwork,
} from '../src/panels';

/** Build a console-plugin (EventType=6) event. */
function consoleEvent(level: string, args: unknown[], timestamp = 0): eventWithTime {
  return {
    type: EventType.Plugin,
    data: { plugin: CONSOLE_PLUGIN, payload: { level, payload: args, trace: [] } },
    timestamp,
  } as unknown as eventWithTime;
}

/** Build a network custom-event (EventType=5, tag tracelane.test.network-error). */
function networkEvent(payload: Record<string, unknown>, timestamp = 0): eventWithTime {
  return {
    type: EventType.Custom,
    data: { tag: NETWORK_EVENT_TAG, payload },
    timestamp,
  } as unknown as eventWithTime;
}

describe('extractConsole (Task 2.10)', () => {
  it('renders console-plugin events (EventType=6, plugin=rrweb/console@1)', () => {
    const rows = extractConsole([
      consoleEvent('error', ['"boom"'], 10),
      consoleEvent('warn', ['"careful"'], 20),
    ]);
    expect(rows).toEqual([
      { level: 'error', message: 'boom', timestamp: 10 },
      { level: 'warn', message: 'careful', timestamp: 20 },
    ]);
  });

  it('ignores non-console plugin events and other event types', () => {
    const events = [
      { type: EventType.FullSnapshot, data: {}, timestamp: 1 },
      { type: EventType.Plugin, data: { plugin: 'rrweb/other', payload: {} }, timestamp: 2 },
      consoleEvent('log', ['"kept"'], 3),
    ] as unknown as eventWithTime[];
    expect(extractConsole(events)).toEqual([{ level: 'log', message: 'kept', timestamp: 3 }]);
  });

  it('joins multiple args and unwraps JSON-quoted strings', () => {
    const rows = extractConsole([consoleEvent('log', ['"clicked"', 42, '"button"'], 5)]);
    expect(rows[0]?.message).toBe('clicked 42 button');
  });

  it('defaults the level to "log" when missing', () => {
    const e = {
      type: EventType.Plugin,
      data: { plugin: CONSOLE_PLUGIN, payload: { payload: ['"x"'] } },
      timestamp: 1,
    } as unknown as eventWithTime;
    expect(extractConsole([e])[0]?.level).toBe('log');
  });
});

describe('extractNetwork (Task 2.10)', () => {
  it('prefers the v1.1 custom-event path (EventType=5, tag tracelane.test.network-error)', () => {
    const rows = extractNetwork([
      networkEvent({ method: 'GET', url: 'https://api/x', status: 500 }, 100),
      networkEvent({ method: 'POST', url: 'https://api/y', status: 403 }, 200),
    ]);
    expect(rows).toEqual([
      { method: 'GET', url: 'https://api/x', status: 500, timestamp: 100 },
      { method: 'POST', url: 'https://api/y', status: 403, timestamp: 200 },
    ]);
  });

  it('falls back to scraping console.error lines prefixed [tracelane.net] (v1)', () => {
    const rows = extractNetwork([
      consoleEvent('error', [`"${NETWORK_CONSOLE_PREFIX} GET 404 https://api/me"`], 50),
      consoleEvent('log', ['"unrelated"'], 60),
    ]);
    expect(rows).toEqual([{ method: 'GET', url: 'https://api/me', status: 404, timestamp: 50 }]);
  });

  it('parses the prefix line without an explicit method', () => {
    const rows = extractNetwork([
      consoleEvent('error', [`"${NETWORK_CONSOLE_PREFIX} 503 https://api/down"`], 70),
    ]);
    expect(rows[0]).toEqual({ url: 'https://api/down', status: 503, timestamp: 70 });
    expect(rows[0]).not.toHaveProperty('method');
  });

  it('does not scrape the console when rich custom events exist', () => {
    const rows = extractNetwork([
      networkEvent({ method: 'GET', url: 'https://api/rich', status: 500 }, 10),
      consoleEvent('error', [`"${NETWORK_CONSOLE_PREFIX} GET 404 https://api/scraped"`], 20),
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.url).toBe('https://api/rich');
  });

  it('returns an empty array when there is no network signal', () => {
    expect(extractNetwork([consoleEvent('log', ['"hello"'], 1)])).toEqual([]);
  });
});
