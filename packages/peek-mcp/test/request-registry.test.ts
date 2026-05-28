import { describe, expect, it } from 'vitest';
import {
  RequestRegistry,
  type RequestRegistryDeps,
  RequestTimeoutError,
} from '../src/native-host/request-registry.js';

function fakeDeps(): RequestRegistryDeps & { tick(ms: number): void } {
  let counter = 0;
  let nowMs = 0;
  const scheduled: Array<{ cb: () => void; fireAt: number; cleared: boolean }> = [];
  const deps: RequestRegistryDeps = {
    generateId: () => `req-${++counter}`,
    setTimeout(cb, ms) {
      const entry = { cb, fireAt: nowMs + ms, cleared: false };
      scheduled.push(entry);
      return entry;
    },
    clearTimeout(handle) {
      (handle as { cleared: boolean }).cleared = true;
    },
  };
  return Object.assign(deps, {
    tick(ms: number) {
      nowMs += ms;
      for (const entry of scheduled) {
        if (entry.cleared) continue;
        if (entry.fireAt <= nowMs) {
          entry.cleared = true;
          entry.cb();
        }
      }
    },
  });
}

describe('RequestRegistry.create', () => {
  it('returns a unique id and a pending Promise', async () => {
    const reg = new RequestRegistry(fakeDeps());
    const a = reg.create<string>(1000);
    const b = reg.create<string>(1000);
    expect(a.id).not.toBe(b.id);
    expect(reg.pendingCount).toBe(2);
    reg.resolve(a.id, 'ok-a');
    reg.resolve(b.id, 'ok-b');
    await expect(a.response).resolves.toBe('ok-a');
    await expect(b.response).resolves.toBe('ok-b');
    expect(reg.pendingCount).toBe(0);
  });
});

describe('RequestRegistry.resolve / reject', () => {
  it('resolve dispatches the payload to the awaiting promise', async () => {
    const reg = new RequestRegistry(fakeDeps());
    const { id, response } = reg.create<{ ok: boolean }>(1000);
    reg.resolve(id, { ok: true });
    await expect(response).resolves.toEqual({ ok: true });
  });

  it('reject rejects the awaiting promise', async () => {
    const reg = new RequestRegistry(fakeDeps());
    const { id, response } = reg.create<unknown>(1000);
    reg.reject(id, new Error('user denied'));
    await expect(response).rejects.toThrow('user denied');
  });

  it('resolving an unknown id is a no-op (returns false)', () => {
    const reg = new RequestRegistry(fakeDeps());
    expect(reg.resolve('nope', { x: 1 })).toBe(false);
    expect(reg.reject('nope', 'x')).toBe(false);
  });

  it('resolving an already-resolved id is a no-op (second resolve dropped)', async () => {
    const reg = new RequestRegistry(fakeDeps());
    const { id, response } = reg.create<string>(1000);
    expect(reg.resolve(id, 'first')).toBe(true);
    expect(reg.resolve(id, 'second')).toBe(false);
    await expect(response).resolves.toBe('first');
  });
});

describe('RequestRegistry timeout', () => {
  it('rejects with RequestTimeoutError after timeoutMs', async () => {
    const deps = fakeDeps();
    const reg = new RequestRegistry(deps);
    const { id, response } = reg.create<unknown>(5000);
    deps.tick(4999);
    expect(reg.pendingCount).toBe(1);
    deps.tick(2); // cross the deadline
    await expect(response).rejects.toBeInstanceOf(RequestTimeoutError);
    await expect(response).rejects.toMatchObject({ requestId: id, timeoutMs: 5000 });
    expect(reg.pendingCount).toBe(0);
  });

  it('resolving before the timeout cancels the timer (no late reject)', async () => {
    const deps = fakeDeps();
    const reg = new RequestRegistry(deps);
    const { id, response } = reg.create<string>(5000);
    reg.resolve(id, 'ok');
    deps.tick(60_000);
    // If the timer fired the response would have been rejected; the resolve
    // wins because the timer was cleared on resolve.
    await expect(response).resolves.toBe('ok');
  });
});

describe('RequestRegistry.rejectAll', () => {
  it('rejects every in-flight request and returns the count', async () => {
    const reg = new RequestRegistry(fakeDeps());
    const a = reg.create<string>(1000);
    const b = reg.create<string>(1000);
    const c = reg.create<string>(1000);
    const count = reg.rejectAll(new Error('transport closed'));
    expect(count).toBe(3);
    expect(reg.pendingCount).toBe(0);
    await expect(a.response).rejects.toThrow('transport closed');
    await expect(b.response).rejects.toThrow('transport closed');
    await expect(c.response).rejects.toThrow('transport closed');
  });
});
