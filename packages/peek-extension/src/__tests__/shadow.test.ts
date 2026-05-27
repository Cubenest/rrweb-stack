// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  collectShadowReports,
  describeHost,
  getOpenOrClosedShadowRoot,
  toShadowReport,
} from '../relay/shadow';

afterEach(() => {
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

describe('describeHost', () => {
  it('builds a compact id/class-bearing path', () => {
    document.body.innerHTML =
      '<div id="app"><section class="panel foo"><my-widget></my-widget></section></div>';
    const widget = document.querySelector('my-widget') as Element;
    const path = describeHost(widget);
    expect(path).toContain('my-widget');
    expect(path).toContain('#app');
    expect(path).toContain('.panel'); // first class only
    expect(path).not.toContain('foo'); // second class dropped
  });

  it('caps the path depth (breadcrumb, not a unique selector)', () => {
    document.body.innerHTML =
      '<div><div><div><div><div><div><span id="deep"></span></div></div></div></div></div></div>';
    const deep = document.getElementById('deep') as Element;
    const path = describeHost(deep);
    expect(path.split(' > ').length).toBeLessThanOrEqual(5);
  });
});

describe('toShadowReport', () => {
  it('maps a chrome.dom-resolved closed root', () => {
    const host = document.createElement('x-el');
    const report = toShadowReport({
      host,
      root: document.createElement('div').attachShadow({ mode: 'open' }),
      mode: 'closed',
      source: 'chrome.dom',
      depth: 0,
    });
    expect(report.source).toBe('chrome.dom');
    expect(report.mode).toBe('closed');
  });

  it('maps an unreachable host', () => {
    const host = document.createElement('x-el');
    const report = toShadowReport({
      host,
      root: null,
      mode: 'unknown',
      source: 'unreachable',
      depth: 0,
    });
    expect(report.source).toBe('unreachable');
  });
});

describe('getOpenOrClosedShadowRoot', () => {
  it('returns undefined when chrome.dom is absent (Safari / MAIN world)', () => {
    expect(getOpenOrClosedShadowRoot()).toBeUndefined();
  });

  it('wraps chrome.dom.openOrClosedShadowRoot when present', () => {
    const fakeRoot = document.createElement('div').attachShadow({ mode: 'open' });
    const spy = vi.fn().mockReturnValue(fakeRoot);
    (globalThis as { chrome?: unknown }).chrome = { dom: { openOrClosedShadowRoot: spy } };
    try {
      const fn = getOpenOrClosedShadowRoot();
      expect(fn).toBeTypeOf('function');
      const el = document.createElement('x-el');
      expect(fn?.(el)).toBe(fakeRoot);
      expect(spy).toHaveBeenCalledWith(el);
    } finally {
      (globalThis as { chrome?: unknown }).chrome = undefined;
    }
  });
});

describe('collectShadowReports', () => {
  it('drops open shadow roots (rrweb already records those)', () => {
    const host = document.createElement('div');
    host.attachShadow({ mode: 'open' });
    document.body.appendChild(host);
    // No injected helper → open root resolved via el.shadowRoot, source=attachShadow.
    expect(collectShadowReports(document, undefined)).toEqual([]);
  });

  it('reports a closed root reached via the injected chrome.dom helper', () => {
    const host = document.createElement('x-card');
    // Real closed root: el.shadowRoot is null, helper returns the captured root.
    const closedRoot = host.attachShadow({ mode: 'closed' });
    document.body.appendChild(host);
    const helper = (el: Element): ShadowRoot | null => (el === host ? closedRoot : null);

    const reports = collectShadowReports(document, helper);
    expect(reports).toHaveLength(1);
    expect(reports[0]).toMatchObject({ source: 'chrome.dom', mode: 'closed' });
    expect(reports[0]?.hostPath).toContain('x-card');
  });

  it('reports a heuristically-unreachable custom element when no helper is given', () => {
    // Custom element (hyphenated tag) with no light-DOM children → heuristic
    // "probably closed shadow host" → source=unreachable.
    const host = document.createElement('my-thing');
    document.body.appendChild(host);
    const reports = collectShadowReports(document, undefined);
    expect(reports.some((r) => r.source === 'unreachable' && r.hostPath.includes('my-thing'))).toBe(
      true,
    );
  });
});
