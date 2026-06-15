import { useEffect, useState } from 'react';
import { type NativeHostStateView, sendCmd } from '../../src/messaging/protocol';

const POLL_INTERVAL_MS = 2000;

/** What a dead/asleep SW degrades to: not connected, no failed attempts seen. */
const DISCONNECTED_VIEW: NativeHostStateView = { state: 'disconnected', reconnectAttempts: 0 };

/**
 * Read the native-host connection state + consecutive-reconnect count,
 * degrading a missing/asleep service worker to a disconnected view instead of
 * throwing. The sender is injected so the degrade path unit-tests without a
 * browser. The attempt count lets the header surface the "run `peek init`"
 * setup hint once a *persistent* reconnect (host never registered) is detected.
 */
export async function readHostState(
  send: (cmd: { type: 'getNativeHostState' }) => Promise<NativeHostStateView> = (cmd) =>
    sendCmd(cmd),
): Promise<NativeHostStateView> {
  try {
    const res = await send({ type: 'getNativeHostState' });
    return { state: res.state, reconnectAttempts: res.reconnectAttempts ?? 0 };
  } catch {
    return DISCONNECTED_VIEW;
  }
}

/** Poll the native-host connection state for the status header. */
export function useNativeHostState(): NativeHostStateView {
  const [view, setView] = useState<NativeHostStateView>(DISCONNECTED_VIEW);
  useEffect(() => {
    let cancelled = false;
    const poll = (): void => {
      void readHostState().then((v) => {
        if (!cancelled) setView(v);
      });
    };
    poll();
    const timer = setInterval(poll, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);
  return view;
}
