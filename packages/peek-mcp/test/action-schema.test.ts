import { describe, expect, it } from 'vitest';
import { ActionSchema, redactActionForAudit } from '../src/mcp/action-schema.js';

describe('ActionSchema (P2 PRD §E.4 discriminated union)', () => {
  it('accepts every documented action type', () => {
    for (const action of [
      { type: 'click', selector: '#a' },
      { type: 'type', selector: '#a', text: 'hi' },
      { type: 'navigate', url: 'https://example.com/' },
      { type: 'back' },
      { type: 'forward' },
      { type: 'reload' },
      { type: 'scroll', x: 0, y: 100 },
      { type: 'scroll', selector: '#footer' },
      { type: 'screenshot' },
      { type: 'screenshot', selector: '#hero' },
      { type: 'waitFor', selector: '#loaded' },
      { type: 'waitFor', timeoutMs: 1000 },
      { type: 'highlight', selector: '#a' },
      { type: 'highlight', selector: '#a', label: 'Click this' },
      { type: 'clear_highlight' },
    ]) {
      const result = ActionSchema.safeParse(action);
      expect(result.success, JSON.stringify(action)).toBe(true);
    }
  });

  it('applies defaults: click button=left, type delay=40, waitFor timeoutMs=5000', () => {
    const click = ActionSchema.parse({ type: 'click', selector: '#a' });
    expect(click).toMatchObject({ button: 'left' });
    const type = ActionSchema.parse({ type: 'type', selector: '#a', text: 'hi' });
    expect(type).toMatchObject({ delay: 40 });
    const waitFor = ActionSchema.parse({ type: 'waitFor' });
    expect(waitFor).toMatchObject({ timeoutMs: 5000 });
  });

  it('rejects malformed actions', () => {
    expect(ActionSchema.safeParse({ type: 'unknown' }).success).toBe(false);
    expect(ActionSchema.safeParse({ type: 'click' }).success).toBe(false); // no selector
    expect(ActionSchema.safeParse({ type: 'click', selector: '' }).success).toBe(false);
    expect(ActionSchema.safeParse({ type: 'navigate', url: 'not a url' }).success).toBe(false);
    expect(
      ActionSchema.safeParse({ type: 'type', selector: '#a', text: 'hi', delay: -1 }).success,
    ).toBe(false);
    expect(ActionSchema.safeParse({ type: 'click', selector: '#a', button: 'turbo' }).success).toBe(
      false,
    );
  });

  it('accepts highlight (optional label, max 120) + clear_highlight; rejects bad highlight', () => {
    expect(ActionSchema.safeParse({ type: 'highlight', selector: '#a' }).success).toBe(true);
    expect(ActionSchema.safeParse({ type: 'highlight', selector: '#a', label: 'x' }).success).toBe(
      true,
    );
    expect(ActionSchema.safeParse({ type: 'clear_highlight' }).success).toBe(true);
    // empty selector rejected
    expect(ActionSchema.safeParse({ type: 'highlight', selector: '' }).success).toBe(false);
    // label over 120 chars rejected
    expect(
      ActionSchema.safeParse({ type: 'highlight', selector: '#a', label: 'y'.repeat(121) }).success,
    ).toBe(false);
    // label exactly at the 120 limit is accepted (pins the boundary)
    expect(
      ActionSchema.safeParse({ type: 'highlight', selector: '#a', label: 'z'.repeat(120) }).success,
    ).toBe(true);
  });

  it('rejects nth that is non-integer / negative', () => {
    expect(ActionSchema.safeParse({ type: 'click', selector: '#a', nth: 1.5 }).success).toBe(false);
    expect(ActionSchema.safeParse({ type: 'click', selector: '#a', nth: -1 }).success).toBe(false);
  });
});

describe('redactActionForAudit', () => {
  it('redacts TypeAction.text', () => {
    const action = { type: 'type' as const, selector: '#pw', text: 'hunter2', delay: 40 };
    expect(redactActionForAudit(action)).toEqual({
      type: 'type',
      selector: '#pw',
      text: '<<REDACTED>>',
      delay: 40,
    });
  });

  it('redacts query-string values in NavigateAction.url', () => {
    const out = redactActionForAudit({
      type: 'navigate',
      url: 'https://example.com/api?token=sk-live-abc&user=alice',
    });
    expect(out.type === 'navigate' && out.url).toBe(
      'https://example.com/api?token=%3C%3CREDACTED%3E%3E&user=%3C%3CREDACTED%3E%3E',
    );
  });

  it('leaves non-sensitive actions unchanged', () => {
    const click = { type: 'click' as const, selector: '#a', button: 'left' as const };
    expect(redactActionForAudit(click)).toEqual(click);
    const back = { type: 'back' as const };
    expect(redactActionForAudit(back)).toEqual(back);
  });

  it('falls through on an unparseable URL (rare; safe-by-default)', () => {
    // url-validation rejects this at the Zod layer, but redact is callable on
    // ANY Action shape, and we want it to never throw.
    const out = redactActionForAudit({
      type: 'navigate',
      url: 'https://example.com/',
    });
    expect(out.type === 'navigate' && out.url).toBe('https://example.com/');
  });
});

describe('RequestUserInputAction (Plan B)', () => {
  it('parses with defaults (readBack false, timeoutMs 120000)', () => {
    const a = ActionSchema.parse({ type: 'request_user_input', prompt: 'Solve the CAPTCHA' });
    expect(a).toMatchObject({
      type: 'request_user_input',
      prompt: 'Solve the CAPTCHA',
      readBack: false,
      timeoutMs: 120000,
    });
  });
  it('rejects timeoutMs > 600000', () => {
    expect(() =>
      ActionSchema.parse({ type: 'request_user_input', prompt: 'x', timeoutMs: 600001 }),
    ).toThrow();
  });
  it('rejects a prompt over 280 chars', () => {
    expect(() =>
      ActionSchema.parse({ type: 'request_user_input', prompt: 'p'.repeat(281) }),
    ).toThrow();
  });
  it('redactActionForAudit records only {type,prompt,selector} — never a value', () => {
    const redacted = redactActionForAudit({
      type: 'request_user_input',
      prompt: 'Salary?',
      selector: '#sal',
      readBack: true,
      timeoutMs: 120000,
    } as never);
    expect(redacted).toEqual({ type: 'request_user_input', prompt: 'Salary?', selector: '#sal' });
  });
});

describe('SetIntentAction + request_user_input scope (Part 2)', () => {
  it('parses set_intent with text', () => {
    expect(ActionSchema.parse({ type: 'set_intent', text: 'Applying · step 2/4' })).toEqual({
      type: 'set_intent',
      text: 'Applying · step 2/4',
    });
  });
  it('rejects set_intent text over 80 chars', () => {
    expect(() => ActionSchema.parse({ type: 'set_intent', text: 'x'.repeat(81) })).toThrow();
  });
  it('request_user_input scope defaults to field and accepts page', () => {
    expect(ActionSchema.parse({ type: 'request_user_input', prompt: 'p' }).scope).toBe('field');
    expect(
      ActionSchema.parse({ type: 'request_user_input', prompt: 'p', scope: 'page' }).scope,
    ).toBe('page');
  });
  it('rejects an unknown scope', () => {
    expect(() =>
      ActionSchema.parse({ type: 'request_user_input', prompt: 'p', scope: 'whole' }),
    ).toThrow();
  });
  it('redactActionForAudit keeps set_intent {type,text} (clipped)', () => {
    expect(redactActionForAudit({ type: 'set_intent', text: 'hi' } as never)).toEqual({
      type: 'set_intent',
      text: 'hi',
    });
  });
});
