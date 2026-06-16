import { useCallback, useEffect, useRef, useState } from 'react';
import { originFromUrl } from '../../src/activation/origin';
import {
  type ConfirmVerdictMessage,
  type ShowConfirmMessage,
  sendConfirmVerdict,
} from '../../src/messaging/protocol';
import { ConfirmResolutionTracker, isShowConfirmFromBackground } from './confirm-flow';
import { ActionFeedbackToggle } from './sections/ActionFeedbackToggle';
import { AgentControlSection } from './sections/AgentControlSection';
import { CaptureSection } from './sections/CaptureSection';
import { ConfirmBanner, closedVerdict } from './sections/ConfirmBanner';
import { RecordingBorderToggle } from './sections/RecordingBorderToggle';
import { StatusHeader } from './sections/StatusHeader';
import { useActiveTab } from './useActiveTab';

/**
 * peek side panel. Status-first, two-question layout:
 *   1. Status header  — host connection + current-level pill.
 *   2. Capture group  — activation, live activity, masking note, recorder
 *                       controls, deep-capture disclosure.
 *   3. Agent control  — the trust dial + recent-actions audit preview.
 *
 * The Level-3 confirm banner is orchestrated here (it is posted by the SW and
 * must fail-closed on panel close) and renders above the groups when pending.
 */
export function App(): React.JSX.Element {
  const { tabId, url, title } = useActiveTab();
  const origin = originFromUrl(url);

  // The Level-3 confirm banner. The SW posts `showConfirm` and awaits a
  // `confirmVerdict`; a newer prompt replaces an older one (which then times
  // out → deny SW-side, fail-closed).
  const [pendingConfirm, setPendingConfirm] = useState<ShowConfirmMessage | null>(null);
  // Track requestIds that already got a verdict so the cleanup below does NOT
  // send a second (deny) closedVerdict — a late synthetic deny must never
  // override an allow the SW acted on.
  const resolution = useRef(new ConfirmResolutionTracker());

  // Only the extension's OWN background SW may surface a confirm banner.
  useEffect(() => {
    const listener = (message: unknown, sender: chrome.runtime.MessageSender): undefined => {
      if (isShowConfirmFromBackground(message, sender, chrome.runtime.id)) {
        setPendingConfirm(message);
      }
      return undefined;
    };
    chrome.runtime.onMessage.addListener(listener);
    return () => chrome.runtime.onMessage.removeListener(listener);
  }, []);

  // Track the latest pending confirm in a ref so the unmount cleanup below can
  // read it without the effect re-running on every replacement.
  const latestPending = useRef<ShowConfirmMessage | null>(null);
  useEffect(() => {
    latestPending.current = pendingConfirm;
  }, [pendingConfirm]);

  // On panel UNMOUNT only: fail-closed for the latest unresolved confirm.
  // Using an empty dep array means this cleanup runs once (on unmount), not on
  // every prompt replacement — so replaced prompts time out SW-side (correct)
  // rather than getting a premature panel-closed verdict.
  useEffect(() => {
    return () => {
      const current = latestPending.current;
      if (!current) return;
      if (resolution.current.shouldSendCloseVerdict(current.requestId)) {
        void sendConfirmVerdict(closedVerdict(current.requestId));
      }
    };
  }, []);

  const resolveConfirm = useCallback((verdict: ConfirmVerdictMessage) => {
    // Mark resolved BEFORE clearing pendingConfirm: setPendingConfirm(null)
    // synchronously schedules the [pendingConfirm] cleanup, which reads the tracker.
    resolution.current.markResolved(verdict.requestId);
    void sendConfirmVerdict(verdict);
    setPendingConfirm(null);
  }, []);

  return (
    <main className="peek-panel">
      <header className="peek-header">
        <h1 className="peek-title">peek</h1>
        <span className="peek-tagline">browser session capture for AI agents</span>
      </header>

      {pendingConfirm ? (
        <ConfirmBanner pending={pendingConfirm} onResolve={resolveConfirm} />
      ) : null}

      <StatusHeader origin={origin} />
      <CaptureSection origin={origin} title={title} tabId={tabId} url={url} />
      <AgentControlSection origin={origin} />
      <RecordingBorderToggle />
      <ActionFeedbackToggle />

      <footer className="peek-footer">
        <span>v0.1.0-alpha · local-only · no telemetry</span>
      </footer>
    </main>
  );
}
