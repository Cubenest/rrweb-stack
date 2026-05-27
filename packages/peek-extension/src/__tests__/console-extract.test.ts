import { describe, expect, it } from 'vitest';
import { EventBatcher } from '../relay/batch';
import { extractConsoleEvent, isConsolePluginEvent } from '../relay/console-extract';

// A realistic rrweb console-plugin event (EventType.Plugin === 6) carrying the
// page's RAW console.log args at data.payload.payload.
function consolePluginEvent(level: string, args: string[], ts = 111): unknown {
  return {
    type: 6,
    timestamp: ts,
    data: {
      plugin: 'rrweb/console@1',
      payload: { level, trace: [], payload: args },
    },
  };
}

describe('isConsolePluginEvent (routing predicate, review issue 1)', () => {
  it('is true for a console-plugin event', () => {
    expect(isConsolePluginEvent(consolePluginEvent('log', ['hi']))).toBe(true);
  });

  it('is false for a non-console rrweb event (e.g. full snapshot type 2)', () => {
    expect(isConsolePluginEvent({ type: 2, data: {} })).toBe(false);
  });

  it('is false for a plugin event from a different plugin', () => {
    expect(isConsolePluginEvent({ type: 6, data: { plugin: 'rrweb/other@1' } })).toBe(false);
  });

  it('is false for non-objects from untrusted postMessage', () => {
    expect(isConsolePluginEvent(null)).toBe(false);
    expect(isConsolePluginEvent('peek')).toBe(false);
    expect(isConsolePluginEvent(6)).toBe(false);
  });
});

describe('extractConsoleEvent', () => {
  it('extracts level + ts and runs args through the masking bank', () => {
    // A regex-bank-recognized secret (Stripe key shape) is redacted.
    const ev = extractConsoleEvent(
      consolePluginEvent('error', ['token=sk_live_abcdefghijklmnopqrstuvwx']),
    );
    expect(ev).not.toBeNull();
    expect(ev?.level).toBe('error');
    expect(ev?.ts).toBe(111);
    expect(ev?.args.join(' ')).not.toContain('sk_live_abcdefghijklmnopqrstuvwx');
  });

  it('masks PII (email) in console args', () => {
    const ev = extractConsoleEvent(consolePluginEvent('log', ['signup: alice@example.com']));
    expect(ev?.args[0]).not.toContain('alice@example.com');
  });

  it('returns null for a non-console event', () => {
    expect(extractConsoleEvent({ type: 2, data: {} })).toBeNull();
  });

  it('defaults level to log and ts to now() when fields are missing/odd', () => {
    const ev = extractConsoleEvent({
      type: 6,
      data: { plugin: 'rrweb/console@1', payload: { payload: ['x'] } },
    });
    expect(ev?.level).toBe('log');
    expect(typeof ev?.ts).toBe('number');
  });
});

describe('relay routing — console events stay out of the raw rrweb batch (issue 1)', () => {
  // Mirror the relay's handleRrweb routing exactly: console-plugin events go
  // ONLY to the masked consoleBatch; everything else to the verbatim rrwebBatch.
  function route(
    payload: unknown,
    rrwebBatch: EventBatcher<unknown>,
    consoleBatch: EventBatcher<unknown>,
  ): void {
    // Mirrors handleRrweb: gate on the SHAPE, not the extraction result, so a
    // malformed console-plugin event is still dropped from rrwebBatch.
    if (isConsolePluginEvent(payload)) {
      const consoleEvent = extractConsoleEvent(payload);
      if (consoleEvent) consoleBatch.add(consoleEvent);
      return; // ALWAYS drop the raw console event
    }
    rrwebBatch.add(payload);
  }

  it('a console-plugin event never lands in the raw rrweb batch (the issue-1 fix)', () => {
    const rrwebBatch = new EventBatcher<unknown>();
    const consoleBatch = new EventBatcher<unknown>();
    // ANY logged arg — the point is the raw console event is not forwarded
    // verbatim at all, so whatever the app logged can't leak via session.append.
    const logged = 'apiKey=sk-live-TOPSECRET-do-not-leak';

    route(consolePluginEvent('warn', [logged]), rrwebBatch, consoleBatch);

    // The raw stream must NOT contain the console event at all.
    expect(rrwebBatch.size).toBe(0);
    expect(JSON.stringify(rrwebBatch.drain())).not.toContain('TOPSECRET');
    // It went to the masked console channel instead.
    expect(consoleBatch.size).toBe(1);
  });

  it('a regex-bank-recognized secret is masked in the console channel', () => {
    const rrwebBatch = new EventBatcher<unknown>();
    const consoleBatch = new EventBatcher<unknown>();
    // A real Stripe-key shape (sk_live_ + 24+ alnum) IS in the PII regex bank.
    const stripeKey = 'sk_live_abcdefghijklmnopqrstuvwx';

    route(consolePluginEvent('error', [`key=${stripeKey}`]), rrwebBatch, consoleBatch);

    expect(rrwebBatch.size).toBe(0);
    expect(JSON.stringify(consoleBatch.drain())).not.toContain(stripeKey);
  });

  it('non-console rrweb events still flow into the raw batch', () => {
    const rrwebBatch = new EventBatcher<unknown>();
    const consoleBatch = new EventBatcher<unknown>();
    route({ type: 3, data: { source: 0 } }, rrwebBatch, consoleBatch); // incremental snapshot
    expect(rrwebBatch.size).toBe(1);
    expect(consoleBatch.size).toBe(0);
  });

  it('a MALFORMED console-plugin event (no data.payload) is dropped, not forwarded raw', () => {
    const rrwebBatch = new EventBatcher<unknown>();
    const consoleBatch = new EventBatcher<unknown>();
    // Passes isConsolePluginEvent (right type + plugin) but extractConsoleEvent
    // returns null (no data.payload). It must NOT fall through to rrwebBatch —
    // the "console events never reach the raw stream" invariant holds for ALL
    // shapes, even ones we can't extract.
    route({ type: 6, data: { plugin: 'rrweb/console@1' } }, rrwebBatch, consoleBatch);
    expect(rrwebBatch.size).toBe(0);
    expect(consoleBatch.size).toBe(0);
  });
});
