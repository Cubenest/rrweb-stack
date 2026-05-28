// DeepCaptureManager — chrome.debugger lifecycle + body capture (Task 3.26).
//
// Drives the manager against a fake DebuggerSurface so the attach/detach
// transitions, the `Network.responseReceived` listener, and the masked-body
// forward path are exercised without a real Chrome instance.

import { describe, expect, it } from 'vitest';
import {
  CDP_PROTOCOL_VERSION,
  type DebuggeeTab,
  type DebuggerSurface,
  DeepCaptureManager,
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
});
