/**
 * Per-tab session registry (SW-side). Each recorded tab maps to one session id
 * that tags every batch forwarded to the native host so peek-mcp groups them
 * into one `sessions` row (ADR-0007). A new session starts when a tab is first
 * seen recording and when it top-frame-navigates to a new origin (a fresh page
 * = a fresh session, matching how a user thinks about "a session").
 *
 * Pure data structure (no `chrome.*`) so it unit-tests; the SW owns the
 * instance + the tabs.onRemoved / onUpdated wiring.
 */

import type { SessionRef } from './native-protocol.js';

/** Generate a session id. `s_` prefix matches the schema's example ids. */
export function newSessionId(): string {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return `s_${crypto.randomUUID()}`;
    }
  } catch {
    /* fall through */
  }
  return `s_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
}

interface TabSession {
  sessionId: string;
  url?: string;
  title?: string;
  /** Origin the session was opened for — a change starts a new session. */
  origin?: string;
}

export class SessionRegistry {
  private readonly byTab = new Map<number, TabSession>();

  /**
   * Get (creating if needed) the session ref for a tab. Passing a `url` whose
   * origin differs from the tab's current session rotates to a new session id
   * (new page = new session). Returns a {@link SessionRef} for native-host
   * messages.
   */
  ensure(
    tabId: number,
    meta?: { url?: string | undefined; title?: string | undefined },
  ): SessionRef {
    const url = meta?.url;
    const title = meta?.title;
    const origin = url ? safeOrigin(url) : undefined;
    let s = this.byTab.get(tabId);

    if (s && origin && s.origin && origin !== s.origin) {
      // Top-frame navigation to a different origin → rotate.
      s = undefined;
    }
    if (!s) {
      s = { sessionId: newSessionId() };
      this.byTab.set(tabId, s);
    }
    if (url !== undefined) {
      s.url = url;
      if (origin !== undefined) s.origin = origin;
    }
    if (title !== undefined) s.title = title;

    const ref: SessionRef = { sessionId: s.sessionId };
    if (s.url !== undefined) ref.url = s.url;
    if (s.title !== undefined) ref.title = s.title;
    return ref;
  }

  /** Read the existing session ref for a tab without creating one. */
  peek(tabId: number): SessionRef | null {
    const s = this.byTab.get(tabId);
    if (!s) return null;
    const ref: SessionRef = { sessionId: s.sessionId };
    if (s.url !== undefined) ref.url = s.url;
    if (s.title !== undefined) ref.title = s.title;
    return ref;
  }

  /** Forget a tab's session (on tab close). */
  clear(tabId: number): void {
    this.byTab.delete(tabId);
  }

  get trackedTabs(): number {
    return this.byTab.size;
  }
}

function safeOrigin(url: string): string | undefined {
  try {
    return new URL(url).origin;
  } catch {
    return undefined;
  }
}
