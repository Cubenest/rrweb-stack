import type { Session } from './brain.js';
import type { PendingRecord } from './types.js';

export interface StoredSession {
  session: Session;
  pending?: PendingRecord;
}

export class SessionStore {
  private sessions = new Map<string, StoredSession>();

  constructor(private readonly newSession: () => Session) {}

  get(conversationId: string): StoredSession {
    let s = this.sessions.get(conversationId);
    if (!s) {
      s = { session: this.newSession() };
      this.sessions.set(conversationId, s);
    }
    return s;
  }

  setPending(conversationId: string, pending: PendingRecord): void {
    this.get(conversationId).pending = pending;
  }

  clearPending(conversationId: string): void {
    // biome-ignore lint/performance/noDelete: exactOptionalPropertyTypes requires delete not undefined assignment
    delete this.get(conversationId).pending;
  }
}
