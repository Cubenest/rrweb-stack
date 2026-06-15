import { describe, expect, it } from 'vitest';
import { describeHostState } from '../../entrypoints/sidepanel/sections/StatusHeader';
import { readHostState } from '../../entrypoints/sidepanel/useNativeHostState';
import { type NativeHostState, ServiceWorkerUnavailableError } from '../messaging/protocol';

describe('describeHostState — native-host state → header view', () => {
  it('connected → ok tone, no setup hint', () => {
    expect(describeHostState('connected')).toEqual({
      tone: 'ok',
      label: 'Connected to peek',
      showSetupHint: false,
    });
  });

  it('reconnecting (briefly) → warn tone, no setup hint yet', () => {
    expect(describeHostState('reconnecting').tone).toBe('warn');
    expect(describeHostState('reconnecting').showSetupHint).toBe(false);
    // A couple of failed attempts is still "transient host restart" territory.
    expect(describeHostState('reconnecting', 1).showSetupHint).toBe(false);
  });

  it('reconnecting persistently → warn tone WITH the setup hint (host likely unregistered)', () => {
    // After enough consecutive failed reconnects the host almost certainly was
    // never registered (the Windows audit bug): surface the "run peek init"
    // guidance even though the wire state is still 'reconnecting', so the user
    // is no longer stuck staring at a perpetual "Reconnecting…" pill.
    const v = describeHostState('reconnecting', 99);
    expect(v.tone).toBe('warn');
    expect(v.showSetupHint).toBe(true);
  });

  it('disconnected → idle tone WITH the peek-init setup hint', () => {
    const v = describeHostState('disconnected');
    expect(v.tone).toBe('idle');
    expect(v.showSetupHint).toBe(true);
  });
});

describe('readHostState — degrades a dead SW to disconnected', () => {
  it('returns the reported host state + attempt count on success', async () => {
    const send = async (): Promise<{ state: NativeHostState; reconnectAttempts: number }> => ({
      state: 'connected',
      reconnectAttempts: 0,
    });
    expect(await readHostState(send)).toEqual({ state: 'connected', reconnectAttempts: 0 });
  });

  it('threads the reconnect attempt count through from the SW', async () => {
    const send = async (): Promise<{ state: NativeHostState; reconnectAttempts: number }> => ({
      state: 'reconnecting',
      reconnectAttempts: 7,
    });
    expect(await readHostState(send)).toEqual({ state: 'reconnecting', reconnectAttempts: 7 });
  });

  it('returns disconnected with zero attempts when the SW is unavailable', async () => {
    const send = async (): Promise<{ state: NativeHostState; reconnectAttempts: number }> => {
      throw new ServiceWorkerUnavailableError();
    };
    expect(await readHostState(send)).toEqual({ state: 'disconnected', reconnectAttempts: 0 });
  });
});
