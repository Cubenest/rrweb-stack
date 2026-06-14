import { describe, expect, it } from 'vitest';
import { ActionSchema, redactActionForAudit } from '../mcp/action-schema.js';

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
  it('clamps/validates timeoutMs to <= 600000 and rejects > max', () => {
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
