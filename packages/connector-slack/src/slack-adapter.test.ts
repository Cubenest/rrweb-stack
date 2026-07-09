import { describe, expect, it, vi } from 'vitest';
import { SlackAdapter, stripMention } from './slack-adapter.js';
import { parseConsentValue, suggestedPrompts } from './slack-adapter.js';

// Mock node:fs so readFileSync is controllable in tests — must be hoisted before imports
vi.mock('node:fs', () => ({
  readFileSync: vi.fn(),
}));

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
//
// IMPORTANT: This mapping is positional and depends on Bolt's internal listener layout.
// The tripwire test below ("Bolt internal listener layout tripwire") asserts that
// listeners.length === 5. If a Bolt version bump shifts the layout, that test fails
// loudly rather than silently exercising the wrong handler.
function getBoltHandler(adapter: SlackAdapter, index: number) {
  const boltApp = (adapter as unknown as { app: { listeners: Array<Array<unknown>> } }).app;
  if (index < 0 || index >= boltApp.listeners.length) {
    throw new Error(
      `getBoltHandler: index ${index} is out of range (listeners.length = ${boltApp.listeners.length}). If a Bolt version bump changed the listener layout, update the index mapping above.`,
    );
  }
  const chain = boltApp.listeners[index];
  if (!chain || chain.length === 0) {
    throw new Error(
      `getBoltHandler: listeners[${index}] is empty or undefined. The Bolt internal listener layout may have changed — re-check the index mapping.`,
    );
  }
  const cb = chain[chain.length - 1];
  if (cb === undefined || cb === null) {
    throw new Error(
      `getBoltHandler: last element of listeners[${index}] chain is ${cb}. Expected the user-supplied callback but got nothing — re-check the index mapping.`,
    );
  }
  return cb as (args: Record<string, unknown>) => Promise<void>;
}

// Tripwire: if Bolt's internal listener layout changes and the index mapping above becomes
// stale, this assertion fails loudly (instead of silently exercising the wrong handler).
describe('Bolt internal listener layout tripwire', () => {
  it('boltApp.listeners has exactly 5 entries after wire() — one per registered handler', () => {
    const { adapter } = makeAdapter();
    const boltApp = (adapter as unknown as { app: { listeners: Array<Array<unknown>> } }).app;
    // If this count changes, re-verify the positional index mapping in getBoltHandler.
    expect(boltApp.listeners).toHaveLength(5);
  });
});

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

  it('does NOT dedupe when botUserId is absent — a message with a mention token falls through to normal gating', async () => {
    // When botId is empty/absent, the dedupe guard `!isDM && botId && text.includes('<@...>')`
    // short-circuits on the falsy botId and does NOT suppress the message. A DM with a
    // mention-looking token must still emit (it reaches the isDM gate instead).
    const { adapter } = makeAdapter();
    const received: string[] = [];
    adapter.onMessage((m) => received.push(m.text));
    const handler = getBoltHandler(adapter, 1);
    await handler({
      message: {
        ts: 'TS7',
        text: '<@SOMEONE> what broke?', // looks like a mention, but botUserId is absent
        user: 'U1',
        channel: 'C3',
        channel_type: 'im', // DM — passes the isDM gate
      },
      context: { botUserId: '' }, // absent / empty → dedupe check is skipped
    });
    // Falls through the (skipped) dedupe guard → hits isDM gate → emits
    expect(received).toEqual(['<@SOMEONE> what broke?']);
  });

  it('emits for a DM whose text contains the bot mention token (Fix 1 regression: DM + mention was incorrectly dropped)', async () => {
    // Bug: the old code ran the mention-dedupe guard BEFORE isDM. Slack never emits
    // app_mention for DMs, so a DM with "<@BOTID>" was silently dropped — nothing handled it.
    // Fix: dedupe guard is now gated on `!isDM`, so DMs always fall through to the isDM check.
    const { adapter } = makeAdapter();
    const received: string[] = [];
    adapter.onMessage((m) => received.push(m.text));
    const handler = getBoltHandler(adapter, 1);
    await handler({
      message: {
        ts: 'TS8',
        text: '<@UBOT> what broke?',
        user: 'U1',
        channel: 'D1',
        channel_type: 'im', // DM — app_mention never fires here
      },
      context: { botUserId: 'UBOT' }, // non-empty botUserId — was the exact trigger of the bug
    });
    // Must emit: DMs with a mention token must NOT be deduped
    expect(received).toEqual(['<@UBOT> what broke?']);
  });
});

describe('SlackAdapter #activeThreads cap (Fix 4)', () => {
  it('stays at or below 1000 entries after more than 1000 distinct app_mention events', async () => {
    const { adapter } = makeAdapter();
    const mentionHandler = getBoltHandler(adapter, 0);

    // Fire 1005 distinct top-level mentions (each gets a unique ts → unique cid)
    for (let i = 0; i < 1005; i++) {
      await mentionHandler({
        event: {
          text: `<@U0BOT> query ${i}`,
          ts: `TS-cap-${i}`,
          thread_ts: undefined,
          user: 'U1',
          channel: 'C1',
        },
        context: { botUserId: 'U0BOT' },
      });
    }

    // #activeThreads is private — verify the observable cap effect:
    // the oldest thread (TS-cap-0) should have been evicted, so a follow-up
    // reply in that thread is NOT treated as an active thread and does NOT emit.
    const received: string[] = [];
    adapter.onMessage((m) => received.push(m.text));
    const msgHandler = getBoltHandler(adapter, 1);
    await msgHandler({
      message: {
        ts: 'TS-cap-0-reply',
        thread_ts: 'TS-cap-0', // oldest — should be evicted
        text: 'evicted thread reply',
        user: 'U1',
        channel: 'C1',
        channel_type: 'channel',
      },
      context: { botUserId: 'U0BOT' },
    });
    // If eviction worked correctly, the oldest thread is gone → no emit
    expect(received).toHaveLength(0);

    // Sanity: a recent thread (TS-cap-1004) is still active → emits
    await msgHandler({
      message: {
        ts: 'TS-cap-1004-reply',
        thread_ts: 'TS-cap-1004',
        text: 'recent thread reply',
        user: 'U1',
        channel: 'C1',
        channel_type: 'channel',
      },
      context: { botUserId: 'U0BOT' },
    });
    expect(received).toEqual(['recent thread reply']);
  });
});

describe('SlackAdapter.postFile', () => {
  // Import the mocked readFileSync after vi.mock hoisting resolves.
  // We use a dynamic import inside each test so the mock is in scope.

  it('reads the file and calls files.uploadV2 with channel, thread_ts, bytes, filename, and initial_comment', async () => {
    const { readFileSync } = await import('node:fs');
    const fakeBytes = Buffer.from('bundle-bytes');
    vi.mocked(readFileSync).mockReturnValue(fakeBytes);

    const uploadV2 = vi.fn().mockResolvedValue({});
    const { adapter } = makeAdapter();
    // Extend the mocked client with files.uploadV2
    (adapter as unknown as { app: { client: unknown } }).app.client = {
      chat: { postMessage: vi.fn().mockResolvedValue({}) },
      assistant: { threads: { setStatus: vi.fn().mockResolvedValue({}) } },
      files: { uploadV2 },
    };
    // Seed the route so postFile can resolve channel + threadTs
    (
      adapter as unknown as { routes: Map<string, { channel: string; threadTs?: string }> }
    ).routes.set('conv-1', { channel: 'C10', threadTs: 'T10' });

    await adapter.postFile(
      'conv-1',
      '/tmp/bundle.peekbundle',
      'bundle.peekbundle',
      'peek session bundle',
    );

    expect(vi.mocked(readFileSync)).toHaveBeenCalledWith('/tmp/bundle.peekbundle');
    expect(uploadV2).toHaveBeenCalledTimes(1);
    const arg = uploadV2.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(arg.channel_id).toBe('C10');
    expect(arg.thread_ts).toBe('T10');
    expect(arg.file).toBe(fakeBytes);
    expect(arg.filename).toBe('bundle.peekbundle');
    expect(arg.initial_comment).toBe('peek session bundle');
  });

  it('omits thread_ts from the uploadV2 call when the route has no threadTs (slash path)', async () => {
    const { readFileSync } = await import('node:fs');
    vi.mocked(readFileSync).mockReturnValue(Buffer.from('bytes'));

    const uploadV2 = vi.fn().mockResolvedValue({});
    const { adapter } = makeAdapter();
    (adapter as unknown as { app: { client: unknown } }).app.client = {
      chat: { postMessage: vi.fn().mockResolvedValue({}) },
      assistant: { threads: { setStatus: vi.fn().mockResolvedValue({}) } },
      files: { uploadV2 },
    };
    // Route without threadTs (slash command path) — omit the key entirely (exactOptionalPropertyTypes)
    (
      adapter as unknown as { routes: Map<string, { channel: string; threadTs?: string }> }
    ).routes.set('cmd-C2-u1', { channel: 'C2' });

    await adapter.postFile('cmd-C2-u1', '/tmp/a.peekbundle', 'a.peekbundle');

    expect(uploadV2).toHaveBeenCalledTimes(1);
    const arg = uploadV2.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(arg.channel_id).toBe('C2');
    expect('thread_ts' in arg).toBe(false); // must be absent, not undefined
    expect('initial_comment' in arg).toBe(false); // no comment → key must be absent
  });

  it('rejects when files.uploadV2 rejects (surfaces the error)', async () => {
    const { readFileSync } = await import('node:fs');
    vi.mocked(readFileSync).mockReturnValue(Buffer.from('bytes'));

    const uploadErr = new Error('network error');
    const uploadV2 = vi.fn().mockRejectedValue(uploadErr);
    const { adapter } = makeAdapter();
    (adapter as unknown as { app: { client: unknown } }).app.client = {
      chat: { postMessage: vi.fn().mockResolvedValue({}) },
      assistant: { threads: { setStatus: vi.fn().mockResolvedValue({}) } },
      files: { uploadV2 },
    };
    (
      adapter as unknown as { routes: Map<string, { channel: string; threadTs?: string }> }
    ).routes.set('conv-err', { channel: 'C3', threadTs: 'T3' });

    await expect(adapter.postFile('conv-err', '/tmp/b.peekbundle', 'b.peekbundle')).rejects.toThrow(
      'network error',
    );
  });
});
