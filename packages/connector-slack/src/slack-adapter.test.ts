import { describe, expect, it } from 'vitest';
import { parseConsentValue, suggestedPrompts } from './slack-adapter.js';

describe('parseConsentValue', () => {
  it('parses a well-formed correlation payload', () => {
    expect(
      parseConsentValue(JSON.stringify({ correlationId: 'c1', conversationId: 't1' })),
    ).toEqual({ correlationId: 'c1', conversationId: 't1' });
  });
  it('returns null on malformed JSON', () => {
    expect(parseConsentValue('not json')).toBeNull();
  });
  it('returns null when fields are missing', () => {
    expect(parseConsentValue(JSON.stringify({ correlationId: 'c1' }))).toBeNull();
  });
});

describe('suggestedPrompts', () => {
  it('offers exactly four assistant prompts with title + message pairs', () => {
    const { title, prompts } = suggestedPrompts();
    expect(title).toBe('Try asking peek:');
    expect(prompts).toHaveLength(4);
    for (const p of prompts) {
      expect(typeof p.title).toBe('string');
      expect(p.title.length).toBeGreaterThan(0);
      expect(typeof p.message).toBe('string');
      expect(p.message.length).toBeGreaterThan(0);
    }
    expect(prompts.map((p) => p.title)).toEqual([
      'What just failed?',
      'Show console errors',
      'What caused it?',
      'Make a Playwright repro',
    ]);
  });
});
