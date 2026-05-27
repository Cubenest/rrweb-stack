import { useEffect, useState } from 'react';

export interface ActiveTab {
  tabId: number | undefined;
  url: string | undefined;
  title: string | undefined;
}

/**
 * Track the active tab in the current window and keep it fresh as the user
 * switches tabs / navigates. The side panel persists across tab switches
 * (P2 PRD §A.6), so we must re-query on `tabs.onActivated` / `onUpdated`.
 */
export function useActiveTab(): ActiveTab {
  const [tab, setTab] = useState<ActiveTab>({
    tabId: undefined,
    url: undefined,
    title: undefined,
  });

  useEffect(() => {
    let cancelled = false;

    async function refresh(): Promise<void> {
      const [active] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (cancelled) return;
      setTab({ tabId: active?.id, url: active?.url, title: active?.title });
    }

    void refresh();

    const onActivated = (): void => void refresh();
    const onUpdated = (_tabId: number, changeInfo: chrome.tabs.OnUpdatedInfo): void => {
      // Only care about URL/title/status changes for metadata display.
      if (changeInfo.url || changeInfo.title || changeInfo.status) void refresh();
    };

    chrome.tabs.onActivated.addListener(onActivated);
    chrome.tabs.onUpdated.addListener(onUpdated);
    return () => {
      cancelled = true;
      chrome.tabs.onActivated.removeListener(onActivated);
      chrome.tabs.onUpdated.removeListener(onUpdated);
    };
  }, []);

  return tab;
}
