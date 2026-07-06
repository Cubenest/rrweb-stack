import { describe, expect, it } from 'vitest';
import { type ElicitCapableServer, buildElicitMessage, elicitConsent } from './elicitation.js';

function server(
  caps: unknown,
  elicitImpl?: () => Promise<{ action: string }>,
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
});

describe('buildElicitMessage', () => {
  it('names the action type', () => {
    expect(buildElicitMessage({ type: 'click' })).toContain('click');
  });
});
