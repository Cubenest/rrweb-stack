import { describe, expect, it } from 'vitest';
import { generatePlaywrightRepro } from '../src/mcp/playwright-repro.js';
import {
  clickEvent,
  documentWith,
  el,
  freshIds,
  fullSnapshot,
  inputEvent,
  metaNav,
  mouseMove,
} from './fixtures/rrweb.js';

function loginFlow() {
  freshIds();
  const email = el('input', { attributes: { name: 'email' } });
  const password = el('input', { attributes: { name: 'password' } });
  const submit = el('button', { attributes: { id: 'login' } });
  const root = documentWith([email, password, submit]);
  const events = [
    metaNav('https://app.test/login', 1000),
    fullSnapshot(root, 1000),
    mouseMove(1050),
    inputEvent(email.id, 'me@x.com', 1100),
    inputEvent(password.id, 'hunter2', 1200),
    clickEvent(submit.id, 1300),
    metaNav('https://app.test/dashboard', 1400),
  ];
  return { events, ids: { email, password, submit } };
}

describe('generatePlaywrightRepro', () => {
  it('emits a runnable test with goto/fill/click in order', () => {
    const { events } = loginFlow();
    const script = generatePlaywrightRepro(events, { title: 'login flow' });

    expect(script).toContain(`import { test, expect } from '@playwright/test';`);
    expect(script).toContain(`test('login flow', async ({ page }) => {`);
    // Ordered statements.
    const lines = script.split('\n');
    const body = lines.filter((l) => l.trim().startsWith('await'));
    expect(body).toEqual([
      `  await page.goto('https://app.test/login');`,
      `  await page.fill('input[name="email"]', 'me@x.com');`,
      `  await page.fill('input[name="password"]', 'hunter2');`,
      `  await page.click('#login');`,
      `  await page.goto('https://app.test/dashboard');`,
    ]);
    expect(script.trimEnd().endsWith('});')).toBe(true);
  });

  it('filters actions to the [startTs, endTs] window', () => {
    const { events } = loginFlow();
    // Only the click at 1300 falls in [1250, 1350].
    const script = generatePlaywrightRepro(events, { startTs: 1250, endTs: 1350 });
    expect(script).toContain(`await page.click('#login');`);
    expect(script).not.toContain('page.goto');
    expect(script).not.toContain('page.fill');
  });

  it('emits selectOption for a <select> input, fill for a text <input>', () => {
    freshIds();
    const lang = el('select', { attributes: { id: 'lang' } });
    const email = el('input', { attributes: { name: 'email' } });
    const root = documentWith([lang, email]);
    const events = [
      fullSnapshot(root, 1000),
      inputEvent(lang.id, 'en', 1100),
      inputEvent(email.id, 'me@x.com', 1200),
    ];
    const script = generatePlaywrightRepro(events);
    expect(script).toContain(`await page.selectOption('#lang', 'en');`);
    expect(script).toContain(`await page.fill('input[name="email"]', 'me@x.com');`);
    expect(script).not.toContain(`page.fill('#lang'`);
  });

  it('escapes single quotes in values', () => {
    freshIds();
    const input = el('input', { attributes: { name: 'note' } });
    const root = documentWith([input]);
    const events = [fullSnapshot(root, 1000), inputEvent(input.id, "it's mine", 1100)];
    const script = generatePlaywrightRepro(events);
    expect(script).toContain(`await page.fill('input[name="note"]', 'it\\'s mine');`);
  });

  it('emits a TODO comment for an unresolved selector instead of dropping it', () => {
    freshIds();
    const root = documentWith([el('div')]);
    const events = [fullSnapshot(root, 1000), clickEvent(999999, 1100)];
    const script = generatePlaywrightRepro(events);
    expect(script).toContain('// TODO: click node#999999 (target selector unresolved)');
  });

  it('notes when no actions were recorded', () => {
    freshIds();
    const root = documentWith([el('div')]);
    const events = [fullSnapshot(root, 1000)];
    const script = generatePlaywrightRepro(events);
    expect(script).toContain('// No user actions were recorded in this window.');
  });

  it('escapes carriage returns so the generated literal stays single-line (M1)', () => {
    freshIds();
    const input = el('input', { attributes: { name: 'note' } });
    const root = documentWith([input]);
    const events = [fullSnapshot(root, 1000), inputEvent(input.id, 'a\r\nb', 1100)];
    const script = generatePlaywrightRepro(events);
    // The fill statement must contain escaped \r and \n, no raw line terminators.
    const fillLine = script.split('\n').find((l) => l.includes('page.fill'));
    expect(fillLine).toBe(`  await page.fill('input[name="note"]', 'a\\r\\nb');`);
  });

  it('caps output to the latest N actions with a truncation note (I1)', () => {
    freshIds();
    const button = el('button', { attributes: { id: 'b' } });
    const root = documentWith([button]);
    const events: ReturnType<typeof clickEvent>[] = [fullSnapshot(root, 1000)];
    for (let i = 1; i <= 250; i += 1) events.push(clickEvent(button.id, 1000 + i));

    const script = generatePlaywrightRepro(events, { maxActions: 200 });
    const clickLines = script.split('\n').filter((l) => l.includes('page.click'));
    expect(clickLines).toHaveLength(200);
    expect(script).toContain('// truncated: showing last 200 of 250 actions');
    // The kept actions are the LATEST 200 (ts 1051..1250); the earliest is dropped.
    expect(script).not.toContain('// truncated: showing last 200 of 250 actions\n  // ');
  });

  it('does not emit a truncation note when under the cap', () => {
    freshIds();
    const button = el('button', { attributes: { id: 'b' } });
    const root = documentWith([button]);
    const events = [fullSnapshot(root, 1000), clickEvent(button.id, 1100)];
    const script = generatePlaywrightRepro(events, { maxActions: 200 });
    expect(script).not.toContain('truncated');
  });
});
