import { describe, expect, it, vi } from 'vitest';
import { SlackAdapter } from './slack-adapter.js';
import { parseConsentValue, suggestedPrompts } from './slack-adapter.js';

describe('parseConsentValue', () => {
  it('parses a well-formed correlation payload', () => {
    expect(
      parseConsentValue(JSON.stringify({ correlationId: 'c1', conversationId: 't1' })),
    ).toEqual({ correlationId: 'c1', conversationId: 't1' });
  });
  it('returns null on malformed JSON', () => {
    expect(parseConsentValue('not json')).toBeNull();
  });
  it('returns null when fields are missing', () => {
    expect(parseConsentValue(JSON.stringify({ correlationId: 'c1' }))).toBeNull();
  });
});

describe('suggestedPrompts', () => {
  it('offers exactly four assistant prompts with title + message pairs', () => {
    const { title, prompts } = suggestedPrompts();
    expect(title).toBe('Try asking peek:');
    expect(prompts).toHaveLength(4);
    for (const p of prompts) {
      expect(typeof p.title).toBe('string');
      expect(p.title.length).toBeGreaterThan(0);
      expect(typeof p.message).toBe('string');
      expect(p.message.length).toBeGreaterThan(0);
    }
    expect(prompts.map((p) => p.title)).toEqual([
      'What just failed?',
      'Show console errors',
      'What caused it?',
      'Make a Playwright repro',
    ]);
  });
});

function makeAdapter(): {
  adapter: SlackAdapter;
  setStatus: ReturnType<typeof vi.fn>;
  postMessage: ReturnType<typeof vi.fn>;
} {
  const setStatus = vi.fn().mockResolvedValue({});
  const postMessage = vi.fn().mockResolvedValue({});
  const adapter = new SlackAdapter({
    slackBotToken: 'xoxb-test',
    slackAppToken: 'xapp-test',
  } as never);
  // Test seam: swap the persisted Bolt client for a fake so post/status are observable.
  (adapter as unknown as { app: { client: unknown } }).app.client = {
    chat: { postMessage },
    assistant: { threads: { setStatus } },
  };
  return { adapter, setStatus, postMessage };
}

describe('SlackAdapter construction', () => {
  it('does not throw or reject synchronously when constructed with fake tokens (no network call)', async () => {
    // Guard: constructing must be network-free. With deferInitialization:true the
    // Bolt App skips the construct-time auth.test() call, so no unhandled rejection fires.
    let adapter: SlackAdapter | undefined;
    expect(() => {
      adapter = new SlackAdapter({
        slackBotToken: 'xoxb-test',
        slackAppToken: 'xapp-test',
      } as never);
    }).not.toThrow();
    // Flush microtasks to surface any immediate promise rejection.
    await Promise.resolve();
    expect(adapter).toBeDefined();
  });
});

describe('SlackAdapter.postError', () => {
  it('posts an errorBlock with the headline as the push fallback text', async () => {
    const { adapter, postMessage } = makeAdapter();
    // Record a route so post() can resolve a channel.
    (
      adapter as unknown as { routes: Map<string, { channel: string; threadTs?: string }> }
    ).routes.set('t1', { channel: 'C1', threadTs: 'T1' });
    await adapter.postError('t1', {
      kind: 'mcp-connection-lost',
      headline: 'Lost peek',
      hint: 'restart it',
    });
    expect(postMessage).toHaveBeenCalledTimes(1);
    const arg = postMessage.mock.calls[0]?.[0] as { text: string; blocks: unknown[] };
    expect(arg.text).toBe('Lost peek'); // meaningful mobile push
    expect(Array.isArray(arg.blocks)).toBe(true);
  });
});

describe('SlackAdapter thinking status', () => {
  it('sets a thread status at message receipt when a thread is present', async () => {
    const { adapter, setStatus } = makeAdapter();
    (
      adapter as unknown as {
        emit: (c: string, ch: string, t: string | undefined, u: string, x: string) => void;
      }
    ).emit('t1', 'C1', 'T1', 'u1', 'hello');
    await vi.waitFor(() => expect(setStatus).toHaveBeenCalledTimes(1));
    expect(setStatus).toHaveBeenCalledWith({
      channel_id: 'C1',
      thread_ts: 'T1',
      status: 'peek is thinking…',
    });
  });

  it('skips the status on the /peek slash path (no thread)', async () => {
    const { adapter, setStatus } = makeAdapter();
    (
      adapter as unknown as {
        emit: (c: string, ch: string, t: string | undefined, u: string, x: string) => void;
      }
    ).emit('cmd-C1-u1', 'C1', undefined, 'u1', 'hi');
    await new Promise((r) => setTimeout(r, 20));
    expect(setStatus).not.toHaveBeenCalled();
  });
});
