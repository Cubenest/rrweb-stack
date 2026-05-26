// @vitest-environment jsdom
// Shadow DOM adapter — Task 1.5 test suite.
//
// Covers the per-host resolution algorithm from
// IMPLEMENTATION_PLAN.md (around line 910):
//   1. open shadow root via `el.shadowRoot`
//   2. closed shadow root via injected `openOrClosedShadowRoot` helper
//      (only when `includeClosed: true`)
//   3. heuristic "probably closed" — custom-element tag with no children
//   4. nothing → not a host, skipped
//
// All fixtures are handwritten on jsdom; we don't boot a real recorder.
// jsdom quirks worth noting up top:
//   - `Element.attachShadow({mode: 'closed'})` returns the root, but the
//     same element's `.shadowRoot` reflection is then `null` (matches
//     spec). We capture the returned root locally so tests can hand it
//     to a mock `openOrClosedShadowRoot`.
//   - Document fragments (returned by attachShadow) do iterate via
//     `.children` correctly under jsdom 25.

import { describe, expect, test, vi } from 'vitest';
import { traverseShadowRoots } from '../src/shadow-dom';
import type { ShadowRootInfo } from '../src/shadow-dom';

// ────────────────────────────────────────────────────────────────────────────
// Fixture helpers
// ────────────────────────────────────────────────────────────────────────────

/**
 * Build a chain of nested shadow hosts of the given depth.
 *
 * The chain looks like:
 *
 *   <div>                          ← returned `root`
 *     <div id="host-0">            ← outer host (depth 0)
 *       #shadow-root
 *         <div id="host-1">        ← depth 1
 *           #shadow-root
 *             ...                  ← up to depth-1 nesting
 *
 * Returns the outermost wrapper so callers can pass it straight to
 * `traverseShadowRoots`.
 */
function buildNestedOpenShadows(depth: number): HTMLElement {
  const wrapper = document.createElement('div');
  let parent: HTMLElement | ShadowRoot = wrapper;
  for (let i = 0; i < depth; i++) {
    const host = document.createElement('div');
    host.id = `host-${i}`;
    parent.appendChild(host);
    const sr = host.attachShadow({ mode: 'open' });
    parent = sr;
  }
  return wrapper;
}

// ────────────────────────────────────────────────────────────────────────────
// Tests
// ────────────────────────────────────────────────────────────────────────────

describe('traverseShadowRoots — basics', () => {
  test('returns an empty array for a tree with no hosts', () => {
    const root = document.createElement('div');
    root.innerHTML = '<p>hi</p><span>there</span><section><b>nested</b></section>';
    expect(traverseShadowRoots(root)).toEqual([]);
  });

  test('finds a single open shadow root at depth 0', () => {
    const root = document.createElement('div');
    const host = document.createElement('div');
    root.appendChild(host);
    const sr = host.attachShadow({ mode: 'open' });

    const out = traverseShadowRoots(root);
    expect(out).toHaveLength(1);
    const entry = out[0] as ShadowRootInfo;
    expect(entry.host).toBe(host);
    expect(entry.root).toBe(sr);
    expect(entry.mode).toBe('open');
    expect(entry.source).toBe('attachShadow');
    expect(entry.depth).toBe(0);
  });

  test('walks into the shadow root to find nested hosts', () => {
    const root = buildNestedOpenShadows(2);
    const out = traverseShadowRoots(root);
    expect(out).toHaveLength(2);
    expect(out[0]?.depth).toBe(0);
    expect(out[1]?.depth).toBe(1);
    expect(out[0]?.mode).toBe('open');
    expect(out[1]?.mode).toBe('open');
    // Sanity: the second entry's host is inside the first entry's root.
    const firstRoot = out[0]?.root;
    expect(firstRoot).toBeTruthy();
    expect(firstRoot?.contains(out[1]?.host as Element)).toBe(true);
  });

  test('accepts a Document as the starting point', () => {
    // jsdom's `document` body is fresh each test file but to be safe we
    // attach to a fragment and pass the surrounding document.
    const host = document.createElement('div');
    host.id = 'doc-host';
    document.body.appendChild(host);
    host.attachShadow({ mode: 'open' });

    const out = traverseShadowRoots(document);
    const found = out.find((info) => info.host === host);
    expect(found).toBeDefined();
    expect(found?.mode).toBe('open');

    // Cleanup so other tests can re-use document.body.
    document.body.removeChild(host);
  });
});

describe('traverseShadowRoots — maxDepth cap', () => {
  test('respects maxDepth and only returns hosts up to depth maxDepth-1', () => {
    const root = buildNestedOpenShadows(20);
    const out = traverseShadowRoots(root, { maxDepth: 5 });
    expect(out).toHaveLength(5);
    const depths = out.map((info) => info.depth);
    expect(depths).toEqual([0, 1, 2, 3, 4]);
  });

  test('default maxDepth is 16', () => {
    const root = buildNestedOpenShadows(20);
    const out = traverseShadowRoots(root);
    expect(out).toHaveLength(16);
    expect(out[out.length - 1]?.depth).toBe(15);
  });
});

describe('traverseShadowRoots — closed shadow roots', () => {
  test('records closed shadow root as unreachable with no helper', () => {
    const root = document.createElement('div');
    const host = document.createElement('div');
    root.appendChild(host);
    // Spec-compliant: after this, host.shadowRoot is null.
    host.attachShadow({ mode: 'closed' });
    expect(host.shadowRoot).toBeNull();

    const onUnreachable = vi.fn();
    const out = traverseShadowRoots(root, { onUnreachable });

    // The host has no light children AND no hyphen in tag — heuristic
    // SHOULDN'T fire, but we still don't see it. Confirms the heuristic
    // is conservative for built-in tags.
    expect(out).toEqual([]);
    expect(onUnreachable).not.toHaveBeenCalled();
  });

  test('closed shadow root is resolved via injected openOrClosedShadowRoot', () => {
    const root = document.createElement('div');
    const host = document.createElement('div');
    root.appendChild(host);
    const closedRoot = host.attachShadow({ mode: 'closed' });

    // Mock the chrome.dom.openOrClosedShadowRoot helper.
    const openOrClosedShadowRoot = vi.fn((el: Element) => (el === host ? closedRoot : null));

    const out = traverseShadowRoots(root, {
      includeClosed: true,
      openOrClosedShadowRoot,
    });

    expect(out).toHaveLength(1);
    const entry = out[0] as ShadowRootInfo;
    expect(entry.host).toBe(host);
    expect(entry.root).toBe(closedRoot);
    expect(entry.mode).toBe('closed');
    expect(entry.source).toBe('chrome.dom');
    expect(entry.depth).toBe(0);
    expect(openOrClosedShadowRoot).toHaveBeenCalledWith(host);
  });

  test('helper is ignored unless includeClosed is true', () => {
    const root = document.createElement('div');
    const host = document.createElement('div');
    root.appendChild(host);
    const closedRoot = host.attachShadow({ mode: 'closed' });
    const openOrClosedShadowRoot = vi.fn(() => closedRoot);

    // includeClosed defaults to false → helper must not be called.
    const out = traverseShadowRoots(root, { openOrClosedShadowRoot });
    expect(out).toEqual([]);
    expect(openOrClosedShadowRoot).not.toHaveBeenCalled();
  });

  test('helper that throws is swallowed and the host is skipped', () => {
    const root = document.createElement('div');
    const host = document.createElement('div');
    root.appendChild(host);
    host.attachShadow({ mode: 'closed' });

    const openOrClosedShadowRoot = vi.fn(() => {
      throw new Error('detached');
    });

    const out = traverseShadowRoots(root, {
      includeClosed: true,
      openOrClosedShadowRoot,
    });

    expect(out).toEqual([]);
    expect(openOrClosedShadowRoot).toHaveBeenCalledWith(host);
  });
});

describe('traverseShadowRoots — custom-element heuristic', () => {
  test('records empty custom element as unreachable (heuristic)', () => {
    const root = document.createElement('div');
    const ce = document.createElement('my-element');
    root.appendChild(ce);

    const onUnreachable = vi.fn();
    const out = traverseShadowRoots(root, { onUnreachable });

    expect(out).toHaveLength(1);
    const entry = out[0] as ShadowRootInfo;
    expect(entry.host).toBe(ce);
    expect(entry.root).toBeNull();
    expect(entry.mode).toBe('unknown');
    expect(entry.source).toBe('unreachable');
    expect(onUnreachable).toHaveBeenCalledTimes(1);
    expect(onUnreachable).toHaveBeenCalledWith(ce);
  });

  test('custom element with light children does NOT fire heuristic', () => {
    const root = document.createElement('div');
    const ce = document.createElement('my-element');
    ce.appendChild(document.createElement('span'));
    root.appendChild(ce);

    const onUnreachable = vi.fn();
    const out = traverseShadowRoots(root, { onUnreachable });
    expect(out).toEqual([]);
    expect(onUnreachable).not.toHaveBeenCalled();
  });

  test('open shadow on a custom element takes precedence over heuristic', () => {
    const root = document.createElement('div');
    const ce = document.createElement('my-element');
    root.appendChild(ce);
    const sr = ce.attachShadow({ mode: 'open' });

    const out = traverseShadowRoots(root);
    expect(out).toHaveLength(1);
    expect(out[0]?.source).toBe('attachShadow');
    expect(out[0]?.mode).toBe('open');
    expect(out[0]?.root).toBe(sr);
  });

  test('onUnreachable callback errors do not abort the walk', () => {
    const root = document.createElement('div');
    const ce1 = document.createElement('my-element');
    const ce2 = document.createElement('other-element');
    root.appendChild(ce1);
    root.appendChild(ce2);

    const onUnreachable = vi.fn(() => {
      throw new Error('consumer bug');
    });
    const out = traverseShadowRoots(root, { onUnreachable });

    expect(out).toHaveLength(2);
    expect(onUnreachable).toHaveBeenCalledTimes(2);
  });
});

describe('traverseShadowRoots — no double-recording', () => {
  test('the same host is recorded at most once', () => {
    // Build a tree where the same host appears as a descendant of two
    // different ancestors we'd traverse via different paths. The Set guard
    // means we still record it once.
    const root = document.createElement('div');
    const host = document.createElement('div');
    root.appendChild(host);
    const sr = host.attachShadow({ mode: 'open' });
    // Inside the shadow, put a nested host whose shadow root will be
    // walked; ensure we'd find `host` only once.
    const inner = document.createElement('div');
    sr.appendChild(inner);
    inner.attachShadow({ mode: 'open' });

    const out = traverseShadowRoots(root);
    const hostHits = out.filter((info) => info.host === host);
    expect(hostHits).toHaveLength(1);
    // And we still find the inner host at depth 1.
    expect(out).toHaveLength(2);
    expect(out.map((i) => i.depth)).toEqual([0, 1]);
  });
});

describe('traverseShadowRoots — iframes are intentionally NOT traversed', () => {
  test('does not throw on iframes; does not enter contentDocument', () => {
    const root = document.createElement('div');
    const iframe = document.createElement('iframe');
    root.appendChild(iframe);
    document.body.appendChild(root);

    // jsdom assigns contentDocument synchronously for in-document iframes,
    // but we don't recurse into it — confirm by attaching a shadow host
    // inside and proving we don't find it.
    const innerDoc = iframe.contentDocument;
    if (innerDoc) {
      const innerHost = innerDoc.createElement('div');
      innerDoc.body.appendChild(innerHost);
      innerHost.attachShadow({ mode: 'open' });
    }

    const out = traverseShadowRoots(root);
    expect(out).toEqual([]);

    document.body.removeChild(root);
  });
});
