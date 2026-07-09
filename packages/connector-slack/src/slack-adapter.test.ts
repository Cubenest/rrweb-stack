import { describe, expect, it, vi } from 'vitest';
import { SlackAdapter, stripMention } from './slack-adapter.js';
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

describe('stripMention', () => {
  it('removes the bot mention token(s) and collapses whitespace', () => {
    expect(stripMention('<@U0BOT> what failed?', 'U0BOT')).toBe('what failed?');
    expect(stripMention('hey <@U0BOT>  make a repro', 'U0BOT')).toBe('hey make a repro');
    expect(stripMention('<@U0BOT> <@U0BOT> show errors', 'U0BOT')).toBe('show errors');
  });
  it('leaves text without the bot mention unchanged (trimmed)', () => {
    expect(stripMention('  what failed?  ', 'U0BOT')).toBe('what failed?');
  });
  it('returns empty string for a mention-only message', () => {
    expect(stripMention('<@U0BOT>', 'U0BOT')).toBe('');
  });
});

// Helper to extract the Nth handler registered with app.event/app.message/app.command/app.action.
// After wire() runs:
//   listeners[0] = app_mention handler
//   listeners[1] = app.message handler
//   listeners[2] = /peek command handler
//   listeners[3] = peek_approve action handler
//   listeners[4] = peek_deny action handler
// Each listeners[N] is a chain; the last element is the actual user-supplied callback.
function getBoltHandler(adapter: SlackAdapter, index: number) {
  const boltApp = (adapter as unknown as { app: { listeners: Array<Array<unknown>> } }).app;
  // biome-ignore lint/style/noNonNullAssertion: test seam — index is always in bounds
  const chain = boltApp.listeners[index]!;
  // biome-ignore lint/style/noNonNullAssertion: last element is the user-supplied callback
  return chain[chain.length - 1]! as (args: Record<string, unknown>) => Promise<void>;
}

describe('SlackAdapter app_mention handler', () => {
  it('emits once with conversationId === ts and stripped query on a top-level mention', async () => {
    const { adapter } = makeAdapter();
    const received: Array<{ conversationId: string; userId: string; text: string }> = [];
    adapter.onMessage((m) =>
      received.push({ conversationId: m.conversationId, userId: m.userId, text: m.text }),
    );
    const handler = getBoltHandler(adapter, 0);
    await handler({
      event: {
        text: '<@U0BOT> what failed?',
        ts: 'TS1',
        thread_ts: undefined,
        user: 'U1',
        channel: 'C1',
      },
      context: { botUserId: 'U0BOT' },
    });
    expect(received).toHaveLength(1);
    expect(received[0]).toEqual({ conversationId: 'TS1', userId: 'U1', text: 'what failed?' });
  });

  it('activates the thread so a follow-up app.message reply also emits', async () => {
    const { adapter } = makeAdapter();
    const received: string[] = [];
    adapter.onMessage((m) => received.push(m.text));
    const mentionHandler = getBoltHandler(adapter, 0);
    await mentionHandler({
      event: {
        text: '<@U0BOT> show errors',
        ts: 'TS2',
        thread_ts: undefined,
        user: 'U1',
        channel: 'C1',
      },
      context: { botUserId: 'U0BOT' },
    });
    received.length = 0; // reset — only care about the follow-up
    // Verify thread is now active by checking that a reply emits
    const msgHandler = getBoltHandler(adapter, 1);
    await msgHandler({
      message: {
        ts: 'TS2-reply',
        thread_ts: 'TS2',
        text: 'a follow-up',
        user: 'U1',
        channel: 'C1',
        channel_type: 'channel',
      },
      context: { botUserId: 'U0BOT' },
    });
    expect(received).toEqual(['a follow-up']);
  });
});

describe('SlackAdapter app.message handler (firehose fix)', () => {
  it('emits for a DM message (channel_type: im)', async () => {
    const { adapter } = makeAdapter();
    const received: string[] = [];
    adapter.onMessage((m) => received.push(m.text));
    const handler = getBoltHandler(adapter, 1);
    await handler({
      message: { ts: 'TS3', text: 'hello peek', user: 'U1', channel: 'C2', channel_type: 'im' },
      context: { botUserId: 'U0BOT' },
    });
    expect(received).toEqual(['hello peek']);
  });

  it('does NOT emit for a channel message that is not in an active thread', async () => {
    const { adapter } = makeAdapter();
    const received: string[] = [];
    adapter.onMessage((m) => received.push(m.text));
    const handler = getBoltHandler(adapter, 1);
    await handler({
      message: {
        ts: 'TS4',
        text: 'some channel chatter',
        user: 'U1',
        channel: 'C1',
        channel_type: 'channel',
      },
      context: { botUserId: 'U0BOT' },
    });
    expect(received).toHaveLength(0);
  });

  it('emits for a channel thread reply when that thread was activated by app_mention', async () => {
    const { adapter } = makeAdapter();
    const received: string[] = [];
    adapter.onMessage((m) => received.push(m.text));
    // Activate the thread via app_mention
    const mentionHandler = getBoltHandler(adapter, 0);
    await mentionHandler({
      event: {
        text: '<@U0BOT> what failed?',
        ts: 'TS5',
        thread_ts: undefined,
        user: 'U1',
        channel: 'C1',
      },
      context: { botUserId: 'U0BOT' },
    });
    received.length = 0; // reset — only care about the follow-up
    // Now send a reply in the same thread
    const msgHandler = getBoltHandler(adapter, 1);
    await msgHandler({
      message: {
        ts: 'TS5-reply',
        thread_ts: 'TS5',
        text: 'follow-up question',
        user: 'U1',
        channel: 'C1',
        channel_type: 'channel',
      },
      context: { botUserId: 'U0BOT' },
    });
    expect(received).toEqual(['follow-up question']);
  });

  it('does NOT emit when the message text contains the bot mention (dedupe with app_mention)', async () => {
    const { adapter } = makeAdapter();
    const received: string[] = [];
    adapter.onMessage((m) => received.push(m.text));
    const handler = getBoltHandler(adapter, 1);
    await handler({
      message: {
        ts: 'TS6',
        text: '<@U0BOT> what broke?',
        user: 'U1',
        channel: 'C1',
        channel_type: 'channel',
      },
      context: { botUserId: 'U0BOT' },
    });
    expect(received).toHaveLength(0);
  });
});
