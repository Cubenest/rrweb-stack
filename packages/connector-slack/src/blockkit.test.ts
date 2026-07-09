import { describe, expect, it } from 'vitest';
import {
  codeBlock,
  confirmation,
  consentCard,
  errorBlock,
  humanizeAction,
  looksLikeCode,
  maskValue,
  resultBlocks,
  textBlocks,
} from './blockkit.js';

describe('blockkit', () => {
  it('textBlocks wraps a mrkdwn section', () => {
    expect(textBlocks('hi')).toEqual([{ type: 'section', text: { type: 'mrkdwn', text: 'hi' } }]);
  });
  it('confirmation prefixes a check', () => {
    expect(confirmation('done')).toEqual([
      { type: 'section', text: { type: 'mrkdwn', text: '✅ done' } },
    ]);
  });
});

describe('maskValue (connector-slack copy)', () => {
  it('matches the peek-mcp masking contract', () => {
    expect(maskValue('mail@example.com')).toBe('m•••m');
    expect(maskValue('ab')).toBe('•••');
    expect(maskValue('')).toBe('•••');
  });
});

describe('humanizeAction', () => {
  it('click by selector', () => {
    expect(humanizeAction({ type: 'click', selector: '#go' })).toContain('#go');
    expect(humanizeAction({ type: 'click', selector: '#go' })).toContain('Click');
  });
  it('type masks the text value', () => {
    const s = humanizeAction({ type: 'type', selector: '#email', text: 'secret@x.io' });
    expect(s).toContain('s•••o');
    expect(s).not.toContain('secret@x.io');
  });
  it('navigate names the url', () => {
    expect(humanizeAction({ type: 'navigate', url: 'https://x.test/a' })).toContain(
      'https://x.test/a',
    );
  });
});

describe('consentCard delegated path (summary only, empty details)', () => {
  it('renders the summary in a clean card with header + context + buttons', () => {
    const { blocks } = consentCard(
      'peek wants to Click `#go` on your live browser. Approve?',
      {},
      'c1',
      't1',
    );
    const header = blocks.find((b) => b.type === 'header') as
      | { text: { text: string } }
      | undefined;
    // Neutral header (serves act, delegated-act, AND egress); the summary carries specifics.
    expect(header?.text.text).toBe('peek wants your approval');
    const section = blocks.find((b) => b.type === 'section') as
      | { text: { text: string } }
      | undefined;
    expect(section?.text.text).toContain('Click');
    const context = blocks.find((b) => b.type === 'context') as
      | { elements: Array<{ text: string }> }
      | undefined;
    expect(context?.elements[0]?.text).toContain('c1');
    // Buttons still carry the encoded correlation payload.
    const actions = blocks.find((b) => b.type === 'actions') as {
      elements: Array<{ action_id: string; value: string }>;
    };
    const approve = actions.elements.find((e) => e.action_id === 'peek_approve');
    expect(JSON.parse(approve?.value ?? '{}')).toEqual({
      correlationId: 'c1',
      conversationId: 't1',
    });
    // No raw JSON code block on the delegated path.
    expect(section?.text.text).not.toContain('```');
  });
});

describe('errorBlock', () => {
  it('renders a warning headline + context hint', () => {
    const blocks = errorBlock('Lost the connection to peek', 'Is the peek daemon running?');
    const section = blocks.find((b) => b.type === 'section') as
      | { text: { text: string } }
      | undefined;
    expect(section?.text.text).toContain(':warning:');
    expect(section?.text.text).toContain('Lost the connection to peek');
    const context = blocks.find((b) => b.type === 'context') as
      | { elements: Array<{ text: string }> }
      | undefined;
    expect(context?.elements[0]?.text).toContain('Is the peek daemon running?');
  });
});

describe('looksLikeCode', () => {
  it('detects a fenced block', () => {
    expect(looksLikeCode('here you go:\n```ts\nconst a = 1;\n```')).toBe(true);
  });
  it('detects a Playwright test without a fence', () => {
    expect(
      looksLikeCode(
        "import { test, expect } from '@playwright/test';\ntest('x', async ({ page }) => {})",
      ),
    ).toBe(true);
  });
  it('treats plain forensic prose as non-code', () => {
    expect(looksLikeCode('The button click failed because the network request 500ed.')).toBe(false);
  });
});

describe('codeBlock', () => {
  it('wraps bare code in a single fence', () => {
    const blocks = codeBlock("test('x', async ({ page }) => {})");
    const section = blocks[0] as { text: { text: string } };
    expect(section.text.text.startsWith('```')).toBe(true);
    expect(section.text.text.endsWith('```')).toBe(true);
    // not double-fenced
    expect(section.text.text.split('```').length).toBe(3);
  });
  it('does not double-fence already-fenced input', () => {
    const blocks = codeBlock('```\nconst a = 1;\n```');
    const section = blocks[0] as { text: { text: string } };
    expect(section.text.text.split('```').length).toBe(3);
  });
});

describe('resultBlocks', () => {
  it('routes code to a fenced block', () => {
    const blocks = resultBlocks(
      "import { test } from '@playwright/test';\ntest('x', async ({ page }) => {})",
    );
    const section = blocks[0] as { text: { text: string } };
    expect(section.text.text).toContain('```');
  });
  it('routes prose to a plain mrkdwn section', () => {
    const blocks = resultBlocks('Just some prose.');
    expect(blocks).toEqual([
      { type: 'section', text: { type: 'mrkdwn', text: 'Just some prose.' } },
    ]);
  });
  it('passes mixed prose+fenced text through as mrkdwn without double-fencing', () => {
    // Simulates an LLM reply like "Here's the repro:\n```ts\nconst a=1;\n```"
    const mixed = "Here's the repro:\n```ts\nconst a = 1;\n```";
    const blocks = resultBlocks(mixed);
    // Must route to textBlocks (a single mrkdwn section), not codeBlock
    expect(blocks).toEqual([{ type: 'section', text: { type: 'mrkdwn', text: mixed } }]);
    // Exactly one fence pair in the rendered text — not double-fenced
    const rendered = (blocks[0] as { text: { text: string } }).text.text;
    expect(rendered.split('```').length).toBe(3);
  });
  it('routes bare Playwright code (no fence) through codeBlock — single fence wrap', () => {
    const bare =
      "import { test } from '@playwright/test';\ntest('x', async ({ page }) => { await page.goto('/'); })";
    const blocks = resultBlocks(bare);
    const rendered = (blocks[0] as { text: { text: string } }).text.text;
    // Wrapped in exactly one fence pair
    expect(rendered.startsWith('```')).toBe(true);
    expect(rendered.endsWith('```')).toBe(true);
    expect(rendered.split('```').length).toBe(3);
  });
});

describe('consentCard suspend path (Action details → structured fields)', () => {
  it('renders a humanized sentence + only present/non-default fields, masking text', () => {
    const details = { type: 'type', selector: '#email', text: 'mail@example.com', delay: 40 };
    const { blocks } = consentCard('peek wants to act on your live browser', details, 'c9', 't9');
    const texts = blocks
      .filter((b) => b.type === 'section')
      .map((b) => (b as { text: { text: string } }).text.text)
      .join('\n');
    expect(texts).toContain('Type');
    expect(texts).toContain('m•••m'); // masked
    expect(texts).not.toContain('mail@example.com');
    expect(texts).toContain('#email'); // target field shown
    expect(texts).not.toContain('delay'); // default value omitted
    expect(texts).not.toContain('```'); // classified → no raw JSON
  });
  it('falls back to a raw JSON code block for an unclassifiable details payload', () => {
    const { blocks } = consentCard('peek wants to act', { not: 'an', action: true }, 'c1', 't1');
    const section = blocks.find((b) => b.type === 'section') as
      | { text: { text: string } }
      | undefined;
    expect(section?.text.text).toContain('```');
  });
  it('truncates a huge raw fallback payload', () => {
    const { blocks } = consentCard('peek wants to act', { blob: 'x'.repeat(5000) }, 'c1', 't1');
    const section = blocks.find((b) => b.type === 'section') as
      | { text: { text: string } }
      | undefined;
    expect(section?.text.text).toContain('truncated');
  });
});
