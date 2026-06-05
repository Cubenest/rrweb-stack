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

  it('reconnecting → warn tone, no setup hint', () => {
    expect(describeHostState('reconnecting').tone).toBe('warn');
    expect(describeHostState('reconnecting').showSetupHint).toBe(false);
  });

  it('disconnected → idle tone WITH the peek-init setup hint', () => {
    const v = describeHostState('disconnected');
    expect(v.tone).toBe('idle');
    expect(v.showSetupHint).toBe(true);
  });
});

describe('readHostState — degrades a dead SW to disconnected', () => {
  it('returns the reported host state on success', async () => {
    const send = async (): Promise<{ state: NativeHostState }> => ({ state: 'connected' });
    expect(await readHostState(send)).toBe('connected');
  });

  it('returns disconnected when the SW is unavailable', async () => {
    const send = async (): Promise<{ state: NativeHostState }> => {
      throw new ServiceWorkerUnavailableError();
    };
    expect(await readHostState(send)).toBe('disconnected');
  });
});
