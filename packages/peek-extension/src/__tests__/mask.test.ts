import { describe, expect, it } from 'vitest';
import type { NetMessage } from '../recorder/messages';
import { maskConsoleArgs, maskNetMessage } from '../relay/mask';

// These tests guard THE privacy boundary (ADR-0002, §H1): masking applied in
// the ISOLATED relay before any record leaves the content script. A regression
// here leaks auth headers / PII to the native host.

describe('maskNetMessage — header redaction', () => {
  it('redacts deny-listed headers case-insensitively', () => {
    const rec: NetMessage = {
      kind: 'request',
      id: 'r1',
      ts: 1,
      headers: {
        Authorization: 'Bearer super-secret',
        cookie: 'session=abc',
        'X-Api-Key': 'k-123',
        Accept: 'application/json',
      },
    };
    const out = maskNetMessage(rec);
    expect(out.headers).toEqual({
      Authorization: '<<REDACTED>>',
      cookie: '<<REDACTED>>',
      'X-Api-Key': '<<REDACTED>>',
      Accept: 'application/json',
    });
  });

  it('leaves a record without headers untouched', () => {
    const rec: NetMessage = { kind: 'error', id: 'r2', ts: 1, error: 'boom' };
    expect(maskNetMessage(rec)).toEqual(rec);
  });

  it('does not mutate the input record', () => {
    const rec: NetMessage = {
      kind: 'request',
      id: 'r3',
      ts: 1,
      headers: { Authorization: 'Bearer x' },
    };
    maskNetMessage(rec);
    expect(rec.headers).toEqual({ Authorization: 'Bearer x' }); // original raw, unchanged
  });
});

describe('maskNetMessage — body redaction (PII regex bank)', () => {
  it('redacts a JWT in a request body', () => {
    const jwt =
      'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U';
    const rec: NetMessage = { kind: 'request', id: 'r4', ts: 1, requestBody: `token=${jwt}` };
    const out = maskNetMessage(rec);
    expect(out.requestBody).not.toContain(jwt);
    expect(out.requestBody).toContain('REDACTED');
  });

  it('redacts an email in a response body', () => {
    const rec: NetMessage = {
      kind: 'response',
      id: 'r5',
      ts: 1,
      status: 200,
      responseBody: 'user: alice@example.com logged in',
    };
    const out = maskNetMessage(rec);
    expect(out.responseBody).not.toContain('alice@example.com');
  });

  it('leaves a body with no PII intact', () => {
    const rec: NetMessage = {
      kind: 'response',
      id: 'r6',
      ts: 1,
      status: 200,
      responseBody: '{"ok":true,"count":3}',
    };
    expect(maskNetMessage(rec).responseBody).toBe('{"ok":true,"count":3}');
  });
});

describe('maskConsoleArgs', () => {
  it('masks PII in console args', () => {
    const out = maskConsoleArgs(['user signed up: bob@test.io', 'plain message']);
    expect(out[0]).not.toContain('bob@test.io');
    expect(out[1]).toBe('plain message');
  });

  it('returns a new array of the same length', () => {
    const input = ['a', 'b', 'c'];
    const out = maskConsoleArgs(input);
    expect(out).toHaveLength(3);
    expect(out).not.toBe(input);
  });
});
