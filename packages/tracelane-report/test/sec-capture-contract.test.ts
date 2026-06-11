import { EventType } from '@cubenest/rrweb-core';
import type { eventWithTime } from '@cubenest/rrweb-core';
import { __internal } from '@tracelane/core';
import { analyze } from '@tracelane/security';
import { describe, expect, it, vi } from 'vitest';

// Cross-package contract: the `[tracelane.sec]` line that @tracelane/core's
// network-capture emits for the main document MUST round-trip through
// @tracelane/security's scrapeResponseMeta + analyze. This is the security-side
// analogue of network-capture-contract.test.ts (which pins `[tracelane.net]`).
//
// It lives in @tracelane/report, the one package that already depends on BOTH
// @tracelane/core (the producer) and @tracelane/security (the consumer), so the
// dependency edges stay one-directional and no build cycle is introduced.
//
// analyze() is @tracelane/security's public consumer surface (and exactly what
// report calls); it internally runs scrapeResponseMeta over the same events. So
// asserting analyze() derives the expected findings from the producer's emitted
// line proves the wire format round-trips end-to-end.
//
// The rrweb console plugin JSON-encodes each string arg, so a logged string
// arrives double-quoted under data.payload.payload — we reproduce that exact
// shape and pipe it through the real consumer (no independent mocks).

describe('[tracelane.sec] @tracelane/core → @tracelane/security contract', () => {
  /** Capture exactly what core's page-side logger writes for a meta. */
  function secLineFor(meta: unknown): string {
    let captured = '';
    const spy = vi.spyOn(console, 'error').mockImplementation((m: string) => {
      captured = m;
    });
    __internal.logResponseMetaInPage(JSON.stringify(meta));
    spy.mockRestore();
    return captured;
  }

  /** Wrap a console line in the rrweb console-plugin event shape the consumer reads. */
  function consolePluginEvent(message: string, timestamp: number): eventWithTime {
    return {
      type: EventType.Plugin,
      timestamp,
      data: {
        plugin: 'rrweb/console@1',
        // The console plugin JSON-encodes the string arg.
        payload: { level: 'error', payload: [JSON.stringify(message)], trace: [] },
      },
    } as unknown as eventWithTime;
  }

  it('emits the exact prefixed line the consumer scrapes for', () => {
    const meta = {
      url: 'https://app.test/',
      status: 200,
      isMainDocument: true,
      presentSecurityHeaders: ['content-security-policy'],
      setCookies: [{ name: 'sid', secure: true, httpOnly: true, sameSite: true }],
    };
    // Pin the producer's wire format byte-for-byte.
    expect(secLineFor(meta)).toBe(`[tracelane.sec] ${JSON.stringify(meta)}`);
  });

  it('analyze() round-trips the emitted sec line into the expected findings', () => {
    // https main doc with NO security headers + an insecure cookie → both a
    // missing-header finding (from presentSecurityHeaders) and an insecure-cookie
    // finding (from setCookies), proving both meta fields survive the round-trip.
    const meta = {
      url: 'https://app.test/',
      status: 200,
      isMainDocument: true,
      presentSecurityHeaders: [],
      setCookies: [{ name: 'sid', secure: false, httpOnly: true, sameSite: true }],
    };
    const line = secLineFor(meta);
    const findings = analyze([consolePluginEvent(line, 1000)]);

    const signals = new Set(findings.map((f) => f.signal));
    expect(signals.has('missing-security-header')).toBe(true);
    expect(signals.has('insecure-cookie')).toBe(true);
    // CSP missing is the high-severity header finding; assert the consumer
    // surfaces it by name from the producer's emitted line.
    expect(
      findings.some(
        (f) => f.signal === 'missing-security-header' && f.evidence === 'content-security-policy',
      ),
    ).toBe(true);
  });
});
