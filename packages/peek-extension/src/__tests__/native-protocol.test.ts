import { describe, expect, it } from 'vitest';
import {
  consoleAppend,
  networkAppend,
  sessionAppend,
  shadowReport,
} from '../background/native-protocol';
import type { NetMessage } from '../recorder/messages';

const ref = { sessionId: 's_1', url: 'https://x.test/', title: 'X' };

describe('native-protocol builders', () => {
  it('sessionAppend carries events + session metadata', () => {
    const msg = sessionAppend(ref, [{ type: 2 }, { type: 3 }]);
    expect(msg).toEqual({
      type: 'session.append',
      sessionId: 's_1',
      url: 'https://x.test/',
      title: 'X',
      events: [{ type: 2 }, { type: 3 }],
    });
  });

  it('consoleAppend carries console events', () => {
    const msg = consoleAppend({ sessionId: 's_2' }, [{ ts: 1, level: 'error', args: ['boom'] }]);
    expect(msg).toMatchObject({ type: 'console.append', sessionId: 's_2' });
    expect(msg.events).toHaveLength(1);
  });

  it('networkAppend carries network records', () => {
    const records: NetMessage[] = [{ kind: 'request', id: 'r1', ts: 1 }];
    const msg = networkAppend({ sessionId: 's_3' }, records);
    expect(msg).toMatchObject({ type: 'network.append', sessionId: 's_3' });
    expect(msg.records).toBe(records);
  });

  it('shadowReport carries gap reports', () => {
    const msg = shadowReport({ sessionId: 's_4' }, [
      { hostPath: 'div > x-el', source: 'unreachable', mode: 'unknown' },
    ]);
    expect(msg).toMatchObject({ type: 'shadow.report', sessionId: 's_4' });
    expect(msg.reports).toHaveLength(1);
  });

  it('omits undefined optional session fields (compact wire body)', () => {
    const msg = sessionAppend({ sessionId: 's_5' }, []);
    expect('url' in msg).toBe(false);
    expect('title' in msg).toBe(false);
    expect(msg.sessionId).toBe('s_5');
  });
});
