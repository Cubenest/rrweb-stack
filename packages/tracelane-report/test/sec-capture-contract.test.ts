import { EventType } from '@cubenest/rrweb-core';
import type { eventWithTime } from '@cubenest/rrweb-core';
import { __internal, createRecorder } from '@tracelane/core';
import { analyze } from '@tracelane/security';
import { describe, expect, it } from 'vitest';

// Contract: core builds the privacy-safe meta + injects it as a `tracelane.sec`
// Custom event via the recorder; @tracelane/security's analyze() must derive the
// findings from that exact event. Pins the producer→consumer wire format.
describe('[tracelane.sec] core → security contract (custom-event channel)', () => {
  it('round-trips a recorder-injected meta into findings', () => {
    const meta = {
      url: 'https://app.test/',
      status: 200,
      isMainDocument: true,
      // Built by core's real helpers from raw headers WITH values → proves no value leaks.
      presentSecurityHeaders: __internal.presentSecurityHeaders(
        { 'content-security-policy': "default-src 'self'", 'x-frame-options': 'DENY' },
        __internal.SEC_HEADER_ALLOWLIST,
      ),
      setCookies: __internal.parseSetCookies('sid=secretvalue; HttpOnly'),
    };
    // Stub executor: addCustomEvent only touches the Node buffer (never calls execute).
    const stubExecutor = {
      execute: async () => undefined,
      executeAsync: async () => undefined,
      cdp: async () => undefined,
      on: () => undefined,
    } as unknown as Parameters<typeof createRecorder>[0]['executor'];
    const recorder = createRecorder({ executor: stubExecutor, rrwebBundle: '' });
    recorder.addCustomEvent('tracelane.sec', meta);
    const events = recorder.getBuffer() as eventWithTime[];
    const findings = analyze(events);
    const signals = new Set(findings.map((f) => f.signal));
    expect(signals.has('missing-security-header')).toBe(true); // CSP+XFO present, others missing
    expect(signals.has('insecure-cookie')).toBe(true); // sid missing Secure + SameSite
    // privacy: no header/cookie values anywhere in the events
    const blob = JSON.stringify(events);
    expect(blob).not.toContain("default-src 'self'");
    expect(blob).not.toContain('secretvalue');
    // sanity: the injected event is a tracelane.sec Custom event
    expect(events.some((e) => e.type === EventType.Custom)).toBe(true);
  });
});
