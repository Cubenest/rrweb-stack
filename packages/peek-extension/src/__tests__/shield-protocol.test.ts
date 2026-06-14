import { describe, expect, it } from 'vitest';
import { isShieldInbound } from '../shield/protocol';

describe('isShieldInbound', () => {
  it('accepts shield.ready with a numeric generation', () => {
    expect(isShieldInbound({ type: 'shield.ready', generation: 0 })).toBe(true);
  });
  it('accepts shield.stop', () => {
    expect(isShieldInbound({ type: 'shield.stop' })).toBe(true);
  });
  it('rejects shield.ready without a numeric generation', () => {
    expect(isShieldInbound({ type: 'shield.ready' })).toBe(false);
  });
  it('rejects unrelated messages', () => {
    expect(isShieldInbound({ type: 'recording.state', recording: true })).toBe(false);
    expect(isShieldInbound(null)).toBe(false);
    expect(isShieldInbound('shield.stop')).toBe(false);
  });
});
