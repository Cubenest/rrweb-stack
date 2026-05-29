import { EventType } from '@cubenest/rrweb-core';
import type { CapturedNetworkRequest, NetworkData, eventWithTime } from '@cubenest/rrweb-core';
import { describe, expect, it } from 'vitest';
import {
  CONSOLE_PLUGIN,
  NETWORK_CONSOLE_PREFIX,
  NETWORK_EVENT_TAG,
  NETWORK_PLUGIN,
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

/**
 * Build a network-plugin (EventType=6) event with `data.plugin === 'rrweb/network@1'`,
 * matching the wire format `@cubenest/rrweb-core`'s `getRecordNetworkPlugin`
 * emits.
 */
function networkPluginEvent(
  requests: Partial<CapturedNetworkRequest>[],
  timestamp = 0,
): eventWithTime {
  const payload: NetworkData = { requests: requests as CapturedNetworkRequest[] };
  return {
    type: EventType.Plugin,
    data: { plugin: NETWORK_PLUGIN, payload },
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

describe('extractNetwork — rrweb/network@1 plugin branch (Phase 5)', () => {
  it('extracts failed CapturedNetworkRequest entries from a Plugin event', () => {
    // A batch with one 200 (success — filtered out), one 404, one 500.
    const events = [
      networkPluginEvent(
        [
          { name: 'https://api/ok', method: 'GET', status: 200, timestamp: 101 },
          { name: 'https://api/missing', method: 'GET', status: 404, timestamp: 102 },
          { name: 'https://api/explode', method: 'POST', status: 500, timestamp: 103 },
        ],
        100,
      ),
    ];
    expect(extractNetwork(events)).toEqual([
      { method: 'GET', url: 'https://api/missing', status: 404, timestamp: 102 },
      { method: 'POST', url: 'https://api/explode', status: 500, timestamp: 103 },
    ]);
  });

  it('treats network errors (status === 0) as failed', () => {
    const events = [
      networkPluginEvent(
        [{ name: 'https://api/cors', method: 'GET', status: 0, timestamp: 50 }],
        49,
      ),
    ];
    expect(extractNetwork(events)).toEqual([
      { method: 'GET', url: 'https://api/cors', status: 0, timestamp: 50 },
    ]);
  });

  it('falls back to the wrapping event timestamp when the request omits `timestamp`', () => {
    const events = [networkPluginEvent([{ name: 'https://api/x', status: 500 }], 777)];
    const rows = extractNetwork(events);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.timestamp).toBe(777);
    expect(rows[0]?.status).toBe(500);
    // No `method` field when the captured request omits it.
    expect(rows[0]).not.toHaveProperty('method');
  });

  it('walks multiple Plugin events and concatenates failed requests in order', () => {
    const events = [
      networkPluginEvent([{ name: 'https://api/a', status: 503, timestamp: 10 }], 10),
      networkPluginEvent([{ name: 'https://api/b', status: 502, timestamp: 20 }], 20),
    ];
    expect(extractNetwork(events).map((r) => r.url)).toEqual(['https://api/a', 'https://api/b']);
  });

  it('prefers the plugin branch over the v1.1 custom-event fallback', () => {
    // Both present: plugin branch must win, custom-event must be ignored.
    const events = [
      networkPluginEvent([{ name: 'https://api/plugin', status: 500, timestamp: 10 }], 10),
      networkEvent({ method: 'GET', url: 'https://api/custom', status: 500 }, 20),
    ];
    const rows = extractNetwork(events);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.url).toBe('https://api/plugin');
  });

  it('falls through to the v1.1 custom-event path when the plugin batch has only successes', () => {
    // A plugin event present but the batch is all 2xx — extractor must move on
    // to the v1.1 fallback rather than swallow the input as "plugin owns it".
    const events = [
      networkPluginEvent([{ name: 'https://api/ok', method: 'GET', status: 200, timestamp: 5 }], 5),
      networkEvent({ method: 'GET', url: 'https://api/legacy', status: 500 }, 10),
    ];
    expect(extractNetwork(events)).toEqual([
      { method: 'GET', url: 'https://api/legacy', status: 500, timestamp: 10 },
    ]);
  });

  it('drops requests with no status (PerformanceObserver-only entries)', () => {
    // Initial-resource entries from PerformanceObserver have no status field
    // (the plugin documents this in `CapturedNetworkRequest.status`). They are
    // not "errors" by any definition — drop them.
    const events = [
      networkPluginEvent(
        [
          { name: 'https://cdn/site.css', initiatorType: 'css', timestamp: 1 },
          { name: 'https://api/fail', status: 500, timestamp: 2 },
        ],
        0,
      ),
    ];
    const rows = extractNetwork(events);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.url).toBe('https://api/fail');
  });

  it('regression: the v1.1 custom-event fallback still works for pre-Phase-5 sessions', () => {
    // No Plugin events at all (older recorder): the v1.1 path must still
    // extract — i.e. the new branch did not regress the old one.
    const events = [
      networkEvent({ method: 'PUT', url: 'https://api/old', status: 500 }, 42),
      networkEvent({ method: 'POST', url: 'https://api/older', status: 403 }, 84),
    ];
    expect(extractNetwork(events)).toEqual([
      { method: 'PUT', url: 'https://api/old', status: 500, timestamp: 42 },
      { method: 'POST', url: 'https://api/older', status: 403, timestamp: 84 },
    ]);
  });
});
