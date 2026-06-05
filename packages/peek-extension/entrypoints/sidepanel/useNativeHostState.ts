import { useEffect, useState } from 'react';
import { type NativeHostState, sendCmd } from '../../src/messaging/protocol';

const POLL_INTERVAL_MS = 2000;

/**
 * Read the native-host connection state, degrading a missing/asleep service
 * worker to 'disconnected' instead of throwing. The sender is injected so the
 * degrade path unit-tests without a browser.
 */
export async function readHostState(
  send: (cmd: { type: 'getNativeHostState' }) => Promise<{ state: NativeHostState }> = (cmd) =>
    sendCmd(cmd),
): Promise<NativeHostState> {
  try {
    const res = await send({ type: 'getNativeHostState' });
    return res.state;
  } catch {
    return 'disconnected';
  }
}

/** Poll the native-host connection state for the status header. */
export function useNativeHostState(): NativeHostState {
  const [state, setState] = useState<NativeHostState>('disconnected');
  useEffect(() => {
    let cancelled = false;
    const poll = (): void => {
      void readHostState().then((s) => {
        if (!cancelled) setState(s);
      });
    };
    poll();
    const timer = setInterval(poll, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);
  return state;
}
