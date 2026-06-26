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
      `  await page.locator('input[name="email"]').fill('me@x.com');`,
      `  await page.locator('input[name="password"]').fill('hunter2');`,
      `  await page.locator('#login').click();`,
      `  await page.goto('https://app.test/dashboard');`,
      `  await expect(page).toHaveURL('https://app.test/dashboard');`,
    ]);
    expect(script.trimEnd().endsWith('});')).toBe(true);
  });

  it('filters actions to the [startTs, endTs] window', () => {
    const { events } = loginFlow();
    // Only the click at 1300 falls in [1250, 1350].
    const script = generatePlaywrightRepro(events, { startTs: 1250, endTs: 1350 });
    expect(script).toContain(`await page.locator('#login').click();`);
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
    expect(script).toContain(`await page.locator('#lang').selectOption('en');`);
    expect(script).toContain(`await page.locator('input[name="email"]').fill('me@x.com');`);
    expect(script).not.toContain(`page.fill('#lang'`);
  });

  it('escapes single quotes in values', () => {
    freshIds();
    const input = el('input', { attributes: { name: 'note' } });
    const root = documentWith([input]);
    const events = [fullSnapshot(root, 1000), inputEvent(input.id, "it's mine", 1100)];
    const script = generatePlaywrightRepro(events);
    expect(script).toContain(`await page.locator('input[name="note"]').fill('it\\'s mine');`);
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
    const fillLine = script.split('\n').find((l) => l.includes('.fill('));
    expect(fillLine).toBe(`  await page.locator('input[name="note"]').fill('a\\r\\nb');`);
  });

  it('caps output to the latest N actions with a truncation note (I1)', () => {
    freshIds();
    // Distinct targets so click-dedup doesn't collapse them: 250 buttons, one
    // click each. (Dedup only collapses consecutive same-selector clicks.)
    const buttons = Array.from({ length: 250 }, (_, i) =>
      el('button', { attributes: { id: `b${i}` } }),
    );
    const root = documentWith(buttons);
    const events: ReturnType<typeof clickEvent>[] = [fullSnapshot(root, 1000)];
    for (let i = 0; i < 250; i += 1) {
      const button = buttons[i];
      if (button) events.push(clickEvent(button.id, 1001 + i));
    }

    const script = generatePlaywrightRepro(events, { maxActions: 200 });
    const clickLines = script.split('\n').filter((l) => l.includes('.click()'));
    expect(clickLines).toHaveLength(200);
    expect(script).toContain('// truncated: showing last 200 of 250 actions');
    // The kept actions are the LATEST 200; the earliest is dropped.
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

  // I1 — empty <select> guard: an empty value must not emit selectOption('')
  // which throws at Playwright runtime ("did not find some options"). Instead
  // a TODO comment is emitted so the generated script stays runnable.
  it('emits a TODO comment instead of selectOption when the <select> value is empty (I1)', () => {
    freshIds();
    const lang = el('select', { attributes: { id: 'lang' } });
    const root = documentWith([lang]);
    const events = [fullSnapshot(root, 1000), inputEvent(lang.id, '', 1100)];
    const script = generatePlaywrightRepro(events);
    expect(script).not.toContain('page.selectOption');
    expect(script).toContain('// TODO: <select> reset to placeholder');
  });

  // I3 — escaping test on the selectOption path: a value with a single quote
  // and a newline must be JS-escaped correctly (same jsString() path as fill).
  it('escapes single quotes and newlines in a <select> value (I3)', () => {
    freshIds();
    const lang = el('select', { attributes: { id: 'lang' } });
    const root = documentWith([lang]);
    const events = [fullSnapshot(root, 1000), inputEvent(lang.id, "a'b\nc", 1100)];
    const script = generatePlaywrightRepro(events);
    expect(script).toContain(`await page.locator('#lang').selectOption('a\\'b\\nc');`);
  });

  // --- Tier-0 coalescing / dedup -----------------------------------------

  it('dedups two consecutive navigations to the same url into one goto', () => {
    freshIds();
    const root = documentWith([el('div')]);
    const events = [
      metaNav('https://app.test/home', 1000),
      metaNav('https://app.test/home', 1001),
      fullSnapshot(root, 1002),
    ];
    const script = generatePlaywrightRepro(events);
    const gotoLines = script.split('\n').filter((l) => l.includes('page.goto'));
    expect(gotoLines).toEqual([`  await page.goto('https://app.test/home');`]);
  });

  it('dedups two clicks on the same selector within the coalesce window into one', () => {
    freshIds();
    const button = el('button', { attributes: { id: 'go' } });
    const root = documentWith([button]);
    const events = [
      fullSnapshot(root, 1000),
      clickEvent(button.id, 1100),
      clickEvent(button.id, 1200), // 100ms later, within 700ms window
    ];
    const script = generatePlaywrightRepro(events);
    const clickLines = script.split('\n').filter((l) => l.includes('.click()'));
    expect(clickLines).toEqual([`  await page.locator('#go').click();`]);
  });

  it('keeps two clicks on the same selector spaced beyond the coalesce window', () => {
    freshIds();
    const button = el('button', { attributes: { id: 'go' } });
    const root = documentWith([button]);
    const events = [
      fullSnapshot(root, 1000),
      clickEvent(button.id, 1100),
      clickEvent(button.id, 2000), // 900ms later, beyond 700ms window
    ];
    const script = generatePlaywrightRepro(events);
    const clickLines = script.split('\n').filter((l) => l.includes('.click()'));
    expect(clickLines).toEqual([
      `  await page.locator('#go').click();`,
      `  await page.locator('#go').click();`,
    ]);
  });

  it('coalesces a typing burst into a single fill with the final value', () => {
    freshIds();
    const input = el('input', { attributes: { name: 'q' } });
    const root = documentWith([input]);
    const events = [
      fullSnapshot(root, 1000),
      inputEvent(input.id, 'h', 1100),
      inputEvent(input.id, 'he', 1110),
      inputEvent(input.id, 'hel', 1120),
      inputEvent(input.id, 'hello', 1130),
    ];
    const script = generatePlaywrightRepro(events);
    const fillLines = script.split('\n').filter((l) => l.includes('.fill('));
    expect(fillLines).toEqual([`  await page.locator('input[name="q"]').fill('hello');`]);
  });

  it('emits page.check for a checked checkbox and page.uncheck for an unchecked one', () => {
    freshIds();
    const remember = el('input', { attributes: { type: 'checkbox', id: 'remember' } });
    const optout = el('input', { attributes: { type: 'checkbox', id: 'optout' } });
    const root = documentWith([remember, optout]);
    const events = [
      fullSnapshot(root, 1000),
      inputEvent(remember.id, 'on', 1100, { isChecked: true }),
      inputEvent(optout.id, '', 1200, { isChecked: false }),
    ];
    const script = generatePlaywrightRepro(events);
    expect(script).toContain(`await page.locator('#remember').check();`);
    expect(script).toContain(`await page.locator('#optout').uncheck();`);
    expect(script).not.toContain('page.fill');
  });

  it('emits page.check for a radio input', () => {
    freshIds();
    const radio = el('input', { attributes: { type: 'radio', id: 'plan-pro' } });
    const root = documentWith([radio]);
    const events = [
      fullSnapshot(root, 1000),
      inputEvent(radio.id, 'pro', 1100, { isChecked: true }),
    ];
    const script = generatePlaywrightRepro(events);
    expect(script).toContain(`await page.locator('#plan-pro').check();`);
    expect(script).not.toContain('page.fill');
  });

  it('emits a TODO when a checkbox/radio checked state is unknown', () => {
    freshIds();
    const remember = el('input', { attributes: { type: 'checkbox', id: 'remember' } });
    const root = documentWith([remember]);
    // No isChecked passed → the event carries no isChecked → checked is undefined.
    const events = [fullSnapshot(root, 1000), inputEvent(remember.id, 'on', 1100)];
    const script = generatePlaywrightRepro(events);
    expect(script).toContain('// TODO: <input type="checkbox"> #remember — checked state unknown');
    expect(script).not.toContain('page.check');
    expect(script).not.toContain('page.uncheck');
    expect(script).not.toContain('page.fill');
  });

  it('skips a hidden input with a TODO instead of filling it', () => {
    freshIds();
    const hidden = el('input', { attributes: { type: 'hidden', name: 'csrf' } });
    const root = documentWith([hidden]);
    const events = [fullSnapshot(root, 1000), inputEvent(hidden.id, 'tok123', 1100)];
    const script = generatePlaywrightRepro(events);
    expect(script).not.toContain('page.fill');
    expect(script).toContain('// TODO: skipped <input type="hidden">');
  });

  it('emits a final-URL assertion for the last navigation', () => {
    freshIds();
    const button = el('button', { attributes: { id: 'go' } });
    const root = documentWith([button]);
    const events = [
      metaNav('https://app.test/a', 1000),
      fullSnapshot(root, 1000),
      clickEvent(button.id, 1100),
      metaNav('https://app.test/b', 1200),
    ];
    const script = generatePlaywrightRepro(events);
    expect(script).toContain(`await expect(page).toHaveURL('https://app.test/b');`);
  });

  it('does not emit a final-URL assertion when there is no navigation', () => {
    freshIds();
    const button = el('button', { attributes: { id: 'go' } });
    const root = documentWith([button]);
    const events = [fullSnapshot(root, 1000), clickEvent(button.id, 1100)];
    const script = generatePlaywrightRepro(events);
    expect(script).not.toContain('toHaveURL');
  });

  it('emits semantic locators when available', () => {
    freshIds();
    const search = el('input', { attributes: { placeholder: 'Search' } });
    const submit = el('button', { attributes: { 'data-testid': 'submit' } });
    const root = documentWith([search, submit]);
    const events = [
      fullSnapshot(root, 1000),
      inputEvent(search.id, 'shoes', 1100),
      clickEvent(submit.id, 1200),
    ];
    const script = generatePlaywrightRepro(events, { title: 't' });
    expect(script).toContain(`await page.getByPlaceholder('Search').fill('shoes');`);
    expect(script).toContain(`await page.getByTestId('submit').click();`);
  });
});
