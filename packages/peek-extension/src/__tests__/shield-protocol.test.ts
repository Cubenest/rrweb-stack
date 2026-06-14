import { describe, expect, it } from 'vitest';
import { isShieldInbound, isViewCommand } from '../shield/protocol';

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

describe('isViewCommand', () => {
  it('accepts RAISE with a null label and a numeric generation', () => {
    expect(isViewCommand({ kind: 'RAISE', generation: 0, label: null })).toBe(true);
  });
  it('accepts LABEL with a string label', () => {
    expect(isViewCommand({ kind: 'LABEL', generation: 1, label: 'x' })).toBe(true);
  });
  it('accepts LOWER', () => {
    expect(isViewCommand({ kind: 'LOWER', generation: 2 })).toBe(true);
  });
  it('rejects a missing or non-numeric generation', () => {
    expect(isViewCommand({ kind: 'RAISE', label: null })).toBe(false);
    expect(isViewCommand({ kind: 'RAISE', generation: '1', label: null })).toBe(false);
  });
  it('rejects RAISE/LABEL with a non-string, non-null label', () => {
    expect(isViewCommand({ kind: 'RAISE', generation: 1, label: 42 })).toBe(false);
    expect(isViewCommand({ kind: 'RAISE', generation: 1 })).toBe(false);
    expect(isViewCommand({ kind: 'LABEL', generation: 1, label: 42 })).toBe(false);
  });
  it('rejects an unknown kind', () => {
    expect(isViewCommand({ kind: 'NOPE', generation: 0 })).toBe(false);
  });
  it('rejects null and non-object values', () => {
    expect(isViewCommand(null)).toBe(false);
    expect(isViewCommand('RAISE')).toBe(false);
  });
});
