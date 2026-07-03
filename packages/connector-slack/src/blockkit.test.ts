import { describe, expect, it } from 'vitest';
import { confirmation, consentCard, textBlocks } from './blockkit.js';

describe('blockkit', () => {
  it('textBlocks wraps a mrkdwn section', () => {
    expect(textBlocks('hi')).toEqual([{ type: 'section', text: { type: 'mrkdwn', text: 'hi' } }]);
  });
  it('confirmation prefixes a check', () => {
    expect(confirmation('done')).toEqual([
      { type: 'section', text: { type: 'mrkdwn', text: '✅ done' } },
    ]);
  });
  it('consentCard encodes correlationId+conversationId in both button values', () => {
    const { blocks } = consentCard('peek wants to act', { a: 1 }, 'c1', 't1');
    const actions = blocks.find((b) => b.type === 'actions') as {
      elements: Array<{ action_id: string; value: string }>;
    };
    const approve = actions.elements.find((e) => e.action_id === 'peek_approve');
    const deny = actions.elements.find((e) => e.action_id === 'peek_deny');
    // biome-ignore lint/style/noNonNullAssertion: test asserts element exists; undefined would throw, not silently pass
    expect(JSON.parse(approve!.value)).toEqual({ correlationId: 'c1', conversationId: 't1' });
    // biome-ignore lint/style/noNonNullAssertion: test asserts element exists; undefined would throw, not silently pass
    expect(JSON.parse(deny!.value)).toEqual({ correlationId: 'c1', conversationId: 't1' });
  });
});
