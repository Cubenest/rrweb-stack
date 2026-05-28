// DeepCaptureManager — chrome.debugger lifecycle + body capture (Task 3.26).
//
// Drives the manager against a fake DebuggerSurface so the attach/detach
// transitions, the `Network.responseReceived` listener, and the masked-body
// forward path are exercised without a real Chrome instance.

import { describe, expect, it } from 'vitest';
import {
  BODY_TRUNCATION_MARKER,
  CDP_PROTOCOL_VERSION,
  type DebuggeeTab,
  type DebuggerSurface,
  DeepCaptureManager,
  MAX_BODY_BYTES,
  capBody,
} from '../deep-capture/manager';
import type { NetMessage } from '../recorder/messages';

interface DebugCall {
  method: string;
  target: DebuggeeTab;
  params: Record<string, unknown> | undefined;
}

function fakeDebugger(): {
  surface: DebuggerSurface;
  attaches: DebuggeeTab[];
  detaches: DebuggeeTab[];
  commands: DebugCall[];
  emit: (source: DebuggeeTab, method: string, params: unknown) => void;
  responseBodyForRequest: (requestId: string, body: string, base64Encoded?: boolean) => void;
} {
  const attaches: DebuggeeTab[] = [];
  const detaches: DebuggeeTab[] = [];
  const commands: DebugCall[] = [];
  const listeners = new Set<(source: DebuggeeTab, method: string, params: unknown) => void>();
  const bodies = new Map<string, { body: string; base64Encoded?: boolean }>();

  const surface: DebuggerSurface = {
    async attach(target, protocolVersion) {
      attaches.push(target);
      expect(protocolVersion).toBe(CDP_PROTOCOL_VERSION);
    },
    async detach(target) {
      detaches.push(target);
    },
    async sendCommand(target, method, params) {
      commands.push({ method, target, params });
      if (method === 'Network.getResponseBody') {
        const reqId = (params as { requestId?: string } | undefined)?.requestId;
        if (reqId && bodies.has(reqId)) {
          // biome-ignore lint/style/noNonNullAssertion: existence checked above
          return bodies.get(reqId)! as never;
        }
        throw new Error(`no body for ${reqId}`);
      }
      return undefined as never;
    },
    onEvent(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };

  return {
    surface,
    attaches,
    detaches,
    commands,
    emit(source, method, params) {
      for (const l of listeners) l(source, method, params);
    },
    responseBodyForRequest(requestId, body, base64Encoded) {
      bodies.set(requestId, base64Encoded ? { body, base64Encoded } : { body });
    },
  };
}

describe('DeepCaptureManager — attach lifecycle', () => {
  it('attach() calls chrome.debugger.attach + Network.enable', async () => {
    const fk = fakeDebugger();
    const bodies: Array<{ tabId: number; record: NetMessage }> = [];
    const mgr = new DeepCaptureManager({
      debugger: fk.surface,
      onBody: (tabId, record) => bodies.push({ tabId, record }),
    });

    await mgr.attach(7);
    expect(fk.attaches).toEqual([{ tabId: 7 }]);
    expect(fk.commands.map((c) => c.method)).toContain('Network.enable');
    expect(mgr.attachedTabs).toEqual([7]);
  });

  it('is idempotent — attaching an already-attached tab is a no-op', async () => {
    const fk = fakeDebugger();
    const mgr = new DeepCaptureManager({ debugger: fk.surface, onBody: () => undefined });
    await mgr.attach(7);
    await mgr.attach(7);
    expect(fk.attaches).toHaveLength(1);
  });

  it('detach() calls chrome.debugger.detach and stops listening', async () => {
    const fk = fakeDebugger();
    const bodies: Array<{ tabId: number; record: NetMessage }> = [];
    const mgr = new DeepCaptureManager({
      debugger: fk.surface,
      onBody: (tabId, record) => bodies.push({ tabId, record }),
    });
    await mgr.attach(7);
    await mgr.detach(7);
    expect(fk.detaches).toEqual([{ tabId: 7 }]);
    expect(mgr.attachedTabs).toEqual([]);

    // After detach, an emitted event should NOT trigger a body fetch.
    fk.responseBodyForRequest('req-after-detach', 'should not be captured');
    fk.emit({ tabId: 7 }, 'Network.responseReceived', {
      requestId: 'req-after-detach',
      response: { url: 'https://x/', status: 200 },
    });
    // Give microtasks a tick to settle.
    await new Promise((r) => setTimeout(r, 0));
    expect(bodies).toHaveLength(0);
  });

  it('detach() of a never-attached tab is a no-op', async () => {
    const fk = fakeDebugger();
    const mgr = new DeepCaptureManager({ debugger: fk.surface, onBody: () => undefined });
    await mgr.detach(42);
    expect(fk.detaches).toEqual([]);
  });

  it('detachAll() releases every attached tab', async () => {
    const fk = fakeDebugger();
    const mgr = new DeepCaptureManager({ debugger: fk.surface, onBody: () => undefined });
    await mgr.attach(1);
    await mgr.attach(2);
    await mgr.attach(3);
    await mgr.detachAll();
    expect(mgr.attachedTabs).toEqual([]);
    expect(fk.detaches.map((d) => d.tabId).sort()).toEqual([1, 2, 3]);
  });

  // Privacy: a toggle-off must revoke immediately for every tab of the
  // disabled origin, not just the active one. Without this, background tabs of
  // the disabled origin keep capturing response bodies until the user
  // activates one.
  it('detachOrigin() detaches every attached tab whose URL matches that origin', async () => {
    const fk = fakeDebugger();
    const mgr = new DeepCaptureManager({ debugger: fk.surface, onBody: () => undefined });
    await mgr.attach(10);
    await mgr.attach(11);
    await mgr.attach(20);

    const urlByTab: Record<number, string> = {
      10: 'https://example.com/a',
      11: 'https://example.com/b',
      20: 'https://other.com/c',
    };
    const detached = await mgr.detachOrigin(
      'https://example.com',
      async (tabId) => urlByTab[tabId],
    );

    expect([...detached].sort()).toEqual([10, 11]);
    expect([...mgr.attachedTabs].sort()).toEqual([20]);
    expect(fk.detaches.map((d) => d.tabId).sort()).toEqual([10, 11]);
  });

  it('detachOrigin() skips tabs whose URL is now unresolvable (closed/gone)', async () => {
    const fk = fakeDebugger();
    const mgr = new DeepCaptureManager({ debugger: fk.surface, onBody: () => undefined });
    await mgr.attach(30);
    await mgr.attach(31);

    const detached = await mgr.detachOrigin('https://example.com', async (tabId) => {
      if (tabId === 30) return 'https://example.com/x';
      throw new Error('tab gone');
    });
    expect([...detached]).toEqual([30]);
    expect(mgr.attachedTabs).toEqual([31]); // 31 is left alone (URL unknown)
  });

  it('detachOrigin() leaves OTHER origins attached and does nothing on a no-match origin', async () => {
    const fk = fakeDebugger();
    const mgr = new DeepCaptureManager({ debugger: fk.surface, onBody: () => undefined });
    await mgr.attach(40);
    await mgr.attach(41);
    const urlByTab: Record<number, string> = {
      40: 'https://a.test/',
      41: 'https://b.test/',
    };
    const detached = await mgr.detachOrigin(
      'https://nothing.test',
      async (tabId) => urlByTab[tabId],
    );
    expect(detached).toEqual([]);
    expect([...mgr.attachedTabs].sort()).toEqual([40, 41]);
    expect(fk.detaches).toEqual([]);
  });
});

describe('DeepCaptureManager — response body capture', () => {
  it('on Network.responseReceived, calls Network.getResponseBody + forwards a masked NetMessage', async () => {
    const fk = fakeDebugger();
    const bodies: Array<{ tabId: number; record: NetMessage }> = [];
    const mgr = new DeepCaptureManager({
      debugger: fk.surface,
      onBody: (tabId, record) => bodies.push({ tabId, record }),
    });

    await mgr.attach(9);
    fk.responseBodyForRequest('req-1', 'plain body, no PII here');
    fk.emit({ tabId: 9 }, 'Network.responseReceived', {
      requestId: 'req-1',
      response: { url: 'https://api.test/v1', status: 200 },
    });
    await new Promise((r) => setTimeout(r, 0));

    expect(bodies).toHaveLength(1);
    expect(bodies[0]?.tabId).toBe(9);
    expect(bodies[0]?.record).toMatchObject({
      kind: 'response',
      id: 'req-1',
      url: 'https://api.test/v1',
      status: 200,
      responseBody: 'plain body, no PII here',
    });
  });

  it('drops base64-encoded bodies (binary blob; not safe to mask)', async () => {
    const fk = fakeDebugger();
    const bodies: Array<{ tabId: number; record: NetMessage }> = [];
    const mgr = new DeepCaptureManager({
      debugger: fk.surface,
      onBody: (tabId, record) => bodies.push({ tabId, record }),
    });
    await mgr.attach(9);
    fk.responseBodyForRequest('req-bin', 'AAAAQUFB', true);
    fk.emit({ tabId: 9 }, 'Network.responseReceived', {
      requestId: 'req-bin',
      response: { url: 'https://cdn/img.png', status: 200 },
    });
    await new Promise((r) => setTimeout(r, 0));
    expect(bodies[0]?.record.responseBody).toBe('<<BASE64_BODY_DROPPED>>');
  });

  it('ignores events for OTHER tabs (does not cross-talk between attached tabs)', async () => {
    const fk = fakeDebugger();
    const bodies: Array<{ tabId: number; record: NetMessage }> = [];
    const mgr = new DeepCaptureManager({
      debugger: fk.surface,
      onBody: (tabId, record) => bodies.push({ tabId, record }),
    });
    await mgr.attach(9);
    fk.responseBodyForRequest('req-other', 'wrong tab');
    fk.emit({ tabId: 999 }, 'Network.responseReceived', {
      requestId: 'req-other',
      response: { url: 'https://x/', status: 200 },
    });
    await new Promise((r) => setTimeout(r, 0));
    expect(bodies).toHaveLength(0);
  });

  it('survives a missing body (Network.getResponseBody throws) without crashing', async () => {
    const fk = fakeDebugger();
    const bodies: Array<{ tabId: number; record: NetMessage }> = [];
    const mgr = new DeepCaptureManager({
      debugger: fk.surface,
      onBody: (tabId, record) => bodies.push({ tabId, record }),
    });
    await mgr.attach(9);
    // No responseBodyForRequest — getResponseBody throws.
    fk.emit({ tabId: 9 }, 'Network.responseReceived', {
      requestId: 'no-such-body',
      response: { url: 'https://x/', status: 204 },
    });
    await new Promise((r) => setTimeout(r, 0));
    expect(bodies).toHaveLength(0); // body fetch failed; nothing forwarded
    // Manager is still attached and listening.
    expect(mgr.attachedTabs).toEqual([9]);
  });

  // Body-size cap (256 KB) — keeps ~/.peek/sessions.db from ballooning on a
  // multi-MB response. Truncation is applied AFTER masking so it can't cut
  // through a redaction marker mid-string.
  it('forwards a sub-cap body (~100 KB) UNMODIFIED', async () => {
    const fk = fakeDebugger();
    const bodies: Array<{ tabId: number; record: NetMessage }> = [];
    const mgr = new DeepCaptureManager({
      debugger: fk.surface,
      onBody: (tabId, record) => bodies.push({ tabId, record }),
    });
    await mgr.attach(9);
    const small = 'a'.repeat(100 * 1024); // 100 KB
    fk.responseBodyForRequest('req-small', small);
    fk.emit({ tabId: 9 }, 'Network.responseReceived', {
      requestId: 'req-small',
      response: { url: 'https://api.test/small', status: 200 },
    });
    await new Promise((r) => setTimeout(r, 0));
    expect(bodies).toHaveLength(1);
    expect(bodies[0]?.record.responseBody).toBe(small);
    expect(bodies[0]?.record.responseBody?.endsWith(BODY_TRUNCATION_MARKER)).toBe(false);
  });

  it('truncates an over-cap body (~500 KB) to MAX_BODY_BYTES + BODY_TRUNCATION_MARKER', async () => {
    const fk = fakeDebugger();
    const bodies: Array<{ tabId: number; record: NetMessage }> = [];
    const mgr = new DeepCaptureManager({
      debugger: fk.surface,
      onBody: (tabId, record) => bodies.push({ tabId, record }),
    });
    await mgr.attach(9);
    const large = 'b'.repeat(500 * 1024); // 500 KB
    fk.responseBodyForRequest('req-large', large);
    fk.emit({ tabId: 9 }, 'Network.responseReceived', {
      requestId: 'req-large',
      response: { url: 'https://api.test/large', status: 200 },
    });
    await new Promise((r) => setTimeout(r, 0));
    expect(bodies).toHaveLength(1);
    const body = bodies[0]?.record.responseBody;
    expect(body).toBeDefined();
    // biome-ignore lint/style/noNonNullAssertion: existence checked above
    expect(body!.endsWith(BODY_TRUNCATION_MARKER)).toBe(true);
    // biome-ignore lint/style/noNonNullAssertion: existence checked above
    expect(body!.length).toBe(MAX_BODY_BYTES + BODY_TRUNCATION_MARKER.length);
  });
});

describe('capBody (body-size cap helper)', () => {
  it('returns sub-cap input unchanged', () => {
    const body = 'x'.repeat(100 * 1024);
    expect(capBody(body)).toBe(body);
  });

  it('returns a body at exactly MAX_BODY_BYTES unchanged', () => {
    const body = 'y'.repeat(MAX_BODY_BYTES);
    expect(capBody(body)).toBe(body);
  });

  it('truncates over-cap input to MAX_BODY_BYTES + marker', () => {
    const body = 'z'.repeat(500 * 1024);
    const out = capBody(body);
    expect(out.endsWith(BODY_TRUNCATION_MARKER)).toBe(true);
    expect(out.length).toBe(MAX_BODY_BYTES + BODY_TRUNCATION_MARKER.length);
    // The first MAX_BODY_BYTES chars are the prefix of the input (i.e. we did
    // NOT replace them with the marker, only appended it).
    expect(out.slice(0, MAX_BODY_BYTES)).toBe(body.slice(0, MAX_BODY_BYTES));
  });
});
