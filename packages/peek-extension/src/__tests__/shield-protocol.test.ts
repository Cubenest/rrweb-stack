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

describe('isViewCommand — handoff commands (Plan B)', () => {
  it('accepts ENTER_HANDOFF with prompt + framing (+ optional selector)', () => {
    expect(
      isViewCommand({
        kind: 'ENTER_HANDOFF',
        generation: 3,
        prompt: 'Solve it',
        framing: 'The AI asked…',
      }),
    ).toBe(true);
    expect(
      isViewCommand({
        kind: 'ENTER_HANDOFF',
        generation: 3,
        prompt: 'Solve it',
        framing: 'x',
        selector: '#c',
      }),
    ).toBe(true);
  });
  it('rejects ENTER_HANDOFF without a string prompt/framing', () => {
    expect(isViewCommand({ kind: 'ENTER_HANDOFF', generation: 3, framing: 'x' })).toBe(false);
    expect(isViewCommand({ kind: 'ENTER_HANDOFF', generation: 3, prompt: 'x' })).toBe(false);
  });
  it('accepts EXIT_HANDOFF', () => {
    expect(isViewCommand({ kind: 'EXIT_HANDOFF', generation: 4 })).toBe(true);
  });
});

describe('ENTER_HANDOFF scope (Part 2)', () => {
  it('accepts ENTER_HANDOFF with scope page', () => {
    expect(
      isViewCommand({
        kind: 'ENTER_HANDOFF',
        generation: 1,
        prompt: 'p',
        framing: 'f',
        scope: 'page',
      }),
    ).toBe(true);
  });
  it('accepts ENTER_HANDOFF without scope (defaults handled downstream)', () => {
    expect(isViewCommand({ kind: 'ENTER_HANDOFF', generation: 1, prompt: 'p', framing: 'f' })).toBe(
      true,
    );
  });
  it('rejects an invalid scope', () => {
    expect(
      isViewCommand({
        kind: 'ENTER_HANDOFF',
        generation: 1,
        prompt: 'p',
        framing: 'f',
        scope: 'x',
      }),
    ).toBe(false);
  });
});

describe('isViewCommand — TERMINAL (Slice B)', () => {
  it('isViewCommand accepts a well-formed TERMINAL', () => {
    expect(
      isViewCommand({ kind: 'TERMINAL', generation: 3, status: 'done', label: 'Submitted' }),
    ).toBe(true);
    expect(isViewCommand({ kind: 'TERMINAL', generation: 4, status: 'failed', label: null })).toBe(
      true,
    );
  });
  it('isViewCommand rejects a TERMINAL with a bad status or label', () => {
    expect(isViewCommand({ kind: 'TERMINAL', generation: 3, status: 'ok', label: 'x' })).toBe(
      false,
    );
    expect(isViewCommand({ kind: 'TERMINAL', generation: 3, status: 'done', label: 5 })).toBe(
      false,
    );
    expect(isViewCommand({ kind: 'TERMINAL', generation: 3, label: 'x' })).toBe(false);
  });
});

describe('isShieldInbound — shield.resume (Plan B)', () => {
  it('accepts shield.resume with and without a value', () => {
    expect(isShieldInbound({ type: 'shield.resume' })).toBe(true);
    expect(isShieldInbound({ type: 'shield.resume', value: 'abc' })).toBe(true);
  });
  it('rejects shield.resume with a non-string value', () => {
    expect(isShieldInbound({ type: 'shield.resume', value: 42 })).toBe(false);
  });
});
