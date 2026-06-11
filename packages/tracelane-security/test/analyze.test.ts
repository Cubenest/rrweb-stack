import { EventType } from '@cubenest/rrweb-core';
import type { eventWithTime } from '@cubenest/rrweb-core';
import { describe, expect, it } from 'vitest';
import { SEC_CONSOLE_PREFIX, analyze } from '../src/index.js';

function secEvent(meta: unknown): eventWithTime {
  return {
    type: EventType.Plugin,
    timestamp: 0,
    data: {
      plugin: 'rrweb/console@1',
      payload: {
        level: 'error',
        payload: [JSON.stringify(`${SEC_CONSOLE_PREFIX} ${JSON.stringify(meta)}`)],
      },
    },
  } as unknown as eventWithTime;
}
function anchorSnapshot(): eventWithTime {
  return {
    type: EventType.FullSnapshot,
    timestamp: 0,
    data: {
      node: {
        type: 0,
        id: 0,
        childNodes: [
          {
            type: 2,
            tagName: 'a',
            id: 1,
            childNodes: [],
            attributes: { target: '_blank', href: 'https://x' },
          },
        ],
      },
    },
  } as unknown as eventWithTime;
}

describe('analyze', () => {
  it('returns [] for an empty stream', () => {
    expect(analyze([])).toEqual([]);
  });
  it('composes detectors across the stream', () => {
    const meta = {
      url: 'https://app.test/',
      status: 200,
      isMainDocument: true,
      presentSecurityHeaders: [],
      setCookies: [{ name: 'sid', secure: false, httpOnly: true, sameSite: true }],
    };
    const findings = analyze([secEvent(meta), anchorSnapshot()]);
    const signals = new Set(findings.map((x) => x.signal));
    expect(signals.has('missing-security-header')).toBe(true);
    expect(signals.has('insecure-cookie')).toBe(true);
    expect(signals.has('reverse-tabnabbing')).toBe(true);
  });
  it('sorts by severity (high first)', () => {
    const meta = {
      url: 'https://app.test/',
      status: 200,
      isMainDocument: true,
      presentSecurityHeaders: [],
      setCookies: [],
    };
    const findings = analyze([secEvent(meta)]);
    const ranks = findings.map((f) => ({ high: 0, medium: 1, low: 2 })[f.severity]);
    expect(ranks).toEqual([...ranks].sort((a, b) => a - b));
  });
  it('applies suppressions', () => {
    const meta = {
      url: 'https://app.test/',
      status: 200,
      isMainDocument: true,
      presentSecurityHeaders: [],
      setCookies: [],
    };
    const unsup = analyze([secEvent(meta)]);
    const sup = analyze([secEvent(meta)], { suppress: [{ signal: 'missing-security-header' }] });
    expect(unsup.length).toBeGreaterThan(0);
    expect(sup.some((f) => f.signal === 'missing-security-header')).toBe(false);
  });
  it('breaks severity ties by signal (localeCompare)', () => {
    // Meta missing only x-frame-options → one `medium` missing-security-header.
    // Anchor with target=_blank + no rel → one `medium` reverse-tabnabbing.
    // Both are `medium`, so the tie-break must order by signal:
    // 'missing-security-header' (m) < 'reverse-tabnabbing' (r).
    const meta = {
      url: 'https://app.test/',
      status: 200,
      isMainDocument: true,
      presentSecurityHeaders: [
        'content-security-policy',
        'strict-transport-security',
        'x-content-type-options',
        'referrer-policy',
      ],
      setCookies: [],
    };
    const findings = analyze([secEvent(meta), anchorSnapshot()]);
    const medium = findings.filter((f) => f.severity === 'medium').map((f) => f.signal);
    expect(medium).toEqual(['missing-security-header', 'reverse-tabnabbing']);
  });
  it('never throws even when a detector hits malformed event data (pure + total)', () => {
    const throwy = [
      { type: EventType.FullSnapshot, timestamp: 0, data: null }, // reverse-tabnabbing: (null).node throws
      {
        type: EventType.Plugin,
        timestamp: 0,
        data: { plugin: 'rrweb/console@1', payload: null },
      }, // scrape path: payload null
    ] as unknown as eventWithTime[];
    expect(() => analyze(throwy)).not.toThrow();
    expect(analyze(throwy)).toEqual([]);
  });
});
