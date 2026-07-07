import { describe, expect, it } from 'vitest';
import type { Session } from './brain.js';
import { SessionStore } from './store.js';

const newSession = (): Session => ({ history: [] });

describe('SessionStore', () => {
  it('lazily creates a session with a fresh brain session', () => {
    const store = new SessionStore(newSession);
    const a = store.get('t1');
    expect(a.session.history).toEqual([]);
    expect(a.pending).toBeUndefined();
    expect(store.get('t1')).toBe(a); // stable per conversationId
  });
  it('sets and clears pending as a sibling of session', () => {
    const store = new SessionStore(newSession);
    store.setPending('t1', {
      toolUseId: 'u1',
      toolName: 'execute_action',
      input: {},
      createdAt: 1,
      correlationId: 'c1',
    });
    expect(store.get('t1').pending?.correlationId).toBe('c1');
    store.clearPending('t1');
    expect(store.get('t1').pending).toBeUndefined();
  });
});
