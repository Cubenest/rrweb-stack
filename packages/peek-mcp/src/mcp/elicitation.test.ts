import { describe, expect, it, vi } from 'vitest';
import type { Action } from './action-schema.js';
import {
  type ElicitCapableServer,
  buildElicitMessage,
  elicitConsent,
  maskValue,
} from './elicitation.js';

function server(
  caps: unknown,
  elicitImpl?: (params: unknown, options?: { timeout?: number }) => Promise<{ action: string }>,
): ElicitCapableServer {
  return {
    getClientCapabilities: () => caps as never,
    elicitInput: (elicitImpl ?? (() => Promise.resolve({ action: 'accept' }))) as never,
  };
}

describe('elicitConsent', () => {
  it('returns not-elicited when the client lacks elicitation.form', async () => {
    expect(await elicitConsent(server({}), 'm')).toEqual({
      elicited: false,
      reason: 'no-capability',
    });
    expect(await elicitConsent(server({ elicitation: {} }), 'm')).toEqual({
      elicited: false,
      reason: 'no-capability',
    });
  });
  it('maps accept → approve', async () => {
    const out = await elicitConsent(
      server({ elicitation: { form: {} } }, () => Promise.resolve({ action: 'accept' })),
      'm',
    );
    expect(out).toEqual({ elicited: true, verdict: 'approve', reason: 'accepted' });
  });
  it('maps decline/cancel → deny', async () => {
    for (const action of ['decline', 'cancel']) {
      const out = await elicitConsent(
        server({ elicitation: { form: {} } }, () => Promise.resolve({ action })),
        'm',
      );
      expect(out).toEqual({ elicited: true, verdict: 'deny', reason: 'declined' });
    }
  });
  it('denies on timeout (never hangs)', async () => {
    const out = await elicitConsent(
      server({ elicitation: { form: {} } }, () => new Promise(() => {})),
      'm',
      { timeoutMs: 10 },
    );
    expect(out).toEqual({ elicited: true, verdict: 'deny', reason: 'timeout' });
  });
  it('denies on a throwing/garbage elicitInput', async () => {
    const out = await elicitConsent(
      server({ elicitation: { form: {} } }, () => Promise.reject(new Error('x'))),
      'm',
      { timeoutMs: 1000 },
    );
    expect(out).toEqual({ elicited: true, verdict: 'deny', reason: 'error' });
  });
  it('threads the timeout budget into elicitInput as options.timeout', async () => {
    // The SDK uses options.timeout to set its own request deadline, which must
    // match the module's outer withTimeout budget so a slow-but-valid approval
    // between ~60s (SDK default) and 120s is honored rather than folded to 'error'.
    const spy = vi.fn().mockResolvedValue({ action: 'accept' });
    const srv: ElicitCapableServer = {
      getClientCapabilities: () => ({ elicitation: { form: {} } }),
      elicitInput: spy as never,
    };
    await elicitConsent(srv, 'Allow?', { timeoutMs: 45_000 });
    expect(spy).toHaveBeenCalledTimes(1);
    // Second argument must carry timeout: 45_000
    expect(spy.mock.calls[0]?.[1]).toEqual({ timeout: 45_000 });
  });
});

describe('maskValue', () => {
  it('keeps first + last char, hides the middle with a fixed bullet run', () => {
    expect(maskValue('mail@example.com')).toBe('m•••m');
    expect(maskValue('abcd')).toBe('a•••d');
  });
  it('never reveals a 1- or 2-char secret whole', () => {
    expect(maskValue('')).toBe('•••');
    expect(maskValue('x')).toBe('•••');
    expect(maskValue('ab')).toBe('•••');
  });
});

describe('buildElicitMessage', () => {
  const on = 'on your live browser';
  it('click by selector', () => {
    const a: Action = { type: 'click', selector: '#submit', button: 'left' };
    const m = buildElicitMessage(a);
    expect(m).toContain('Click');
    expect(m).toContain('#submit');
    expect(m).toContain(on);
  });
  it('click by ref with nth', () => {
    const a: Action = { type: 'click', ref: 'e12', nth: 2, button: 'left' };
    const m = buildElicitMessage(a);
    expect(m).toContain('e12');
    expect(m).toContain('#2');
  });
  it('type masks the text value to first/last char', () => {
    const a: Action = { type: 'type', selector: '#email', text: 'mail@example.com', delay: 40 };
    const m = buildElicitMessage(a);
    expect(m).toContain('Type');
    expect(m).toContain('m•••m');
    expect(m).not.toContain('mail@example.com');
    expect(m).toContain('#email');
  });
  it('navigate names the url', () => {
    const a: Action = { type: 'navigate', url: 'https://example.com/app' };
    expect(buildElicitMessage(a)).toContain('https://example.com/app');
  });
  it('request_user_input masks the prompt', () => {
    const a: Action = {
      type: 'request_user_input',
      prompt: 'Enter your one-time code',
      scope: 'field',
      readBack: false,
      timeoutMs: 120000,
    };
    const m = buildElicitMessage(a);
    expect(m).not.toContain('Enter your one-time code');
    expect(m).toContain('E•••e');
  });
  it('screenshot / reload / back / forward read cleanly', () => {
    expect(buildElicitMessage({ type: 'screenshot' })).toContain('screenshot');
    expect(buildElicitMessage({ type: 'reload' })).toContain('Reload');
    expect(buildElicitMessage({ type: 'back' })).toContain('back');
    expect(buildElicitMessage({ type: 'forward' })).toContain('forward');
  });
  it('unknown verb falls back to the generic sentence', () => {
    // Cast an unmodeled type to exercise the default branch defensively.
    const m = buildElicitMessage({ type: 'page_view', maxElements: 200 } as Action);
    expect(m).toContain('page_view');
    expect(m).toContain(on);
  });
});
