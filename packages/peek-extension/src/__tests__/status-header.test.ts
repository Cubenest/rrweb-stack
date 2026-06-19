import { describe, expect, it } from 'vitest';
import { describeHostState } from '../../entrypoints/sidepanel/sections/StatusHeader';
import { readHostState } from '../../entrypoints/sidepanel/useNativeHostState';
import { ServiceWorkerUnavailableError } from '../messaging/protocol';

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

  it('reconnecting BEFORE any connection has held → "Connecting…" (not "Reconnecting…")', () => {
    // Fresh start: the port hasn't held yet, so this is the FIRST connect, not a
    // re-connect. Labelling it "Reconnecting…" implies a connection was lost.
    expect(describeHostState('reconnecting', 0, false).label).toBe('Connecting…');
    expect(describeHostState('reconnecting', 1, false).label).toBe('Connecting…');
  });

  it('reconnecting AFTER a connection has held → "Reconnecting…"', () => {
    expect(describeHostState('reconnecting', 0, true).label).toBe('Reconnecting…');
    expect(describeHostState('reconnecting', 1, true).label).toBe('Reconnecting…');
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
  it('returns the reported host state + attempt count + hasEverConnected on success', async () => {
    const send = async () => ({
      state: 'connected' as const,
      reconnectAttempts: 0,
      hasEverConnected: true,
    });
    expect(await readHostState(send)).toEqual({
      state: 'connected',
      reconnectAttempts: 0,
      hasEverConnected: true,
    });
  });

  it('threads the reconnect attempt count + hasEverConnected through from the SW', async () => {
    const send = async () => ({
      state: 'reconnecting' as const,
      reconnectAttempts: 7,
      hasEverConnected: false,
    });
    expect(await readHostState(send)).toEqual({
      state: 'reconnecting',
      reconnectAttempts: 7,
      hasEverConnected: false,
    });
  });

  it('returns disconnected (never-connected) when the SW is unavailable', async () => {
    const send = async (): Promise<never> => {
      throw new ServiceWorkerUnavailableError();
    };
    expect(await readHostState(send)).toEqual({
      state: 'disconnected',
      reconnectAttempts: 0,
      hasEverConnected: false,
    });
  });
});
