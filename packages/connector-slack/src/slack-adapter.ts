import type {
  ConsentRequest,
  ConsentResponse,
  InboundMessage,
  SurfaceAdapter,
} from '@peekdev/connector-core';
import { App, Assistant } from '@slack/bolt';
import type { BlockAction } from '@slack/bolt';
import { confirmation, consentCard, errorBlock, resultBlocks } from './blockkit.js';
import type { SlackConfig } from './config.js';

interface Route {
  channel: string;
  threadTs: string | undefined;
}

export function suggestedPrompts(): {
  title: string;
  prompts: Array<{ title: string; message: string }>;
} {
  return {
    title: 'Try asking peek:',
    prompts: [
      { title: 'What just failed?', message: 'What failed in my last browser session?' },
      { title: 'Show console errors', message: 'List the console errors from my last session' },
      { title: 'What caused it?', message: 'What did I do right before the last error?' },
      {
        title: 'Make a Playwright repro',
        message: 'Generate a Playwright test for my last session',
      },
    ],
  };
}

/** Strip every `<@BOTID>` token for the connector's own bot user id, collapse whitespace. */
export function stripMention(text: string, botUserId: string): string {
  return text
    .replace(new RegExp(`<@${botUserId}>`, 'g'), ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function parseConsentValue(
  raw: string | undefined,
): { correlationId: string; conversationId: string } | null {
  if (!raw) return null;
  try {
    const p = JSON.parse(raw) as { correlationId?: string; conversationId?: string };
    if (typeof p.correlationId === 'string' && typeof p.conversationId === 'string') {
      return { correlationId: p.correlationId, conversationId: p.conversationId };
    }
    return null;
  } catch {
    return null;
  }
}

export class SlackAdapter implements SurfaceAdapter {
  private app: App;
  private routes = new Map<string, Route>();
  private msgHandler?: (m: InboundMessage) => void;
  private consentHandler?: (r: ConsentResponse) => void;
  #activeThreads = new Set<string>();

  constructor(config: SlackConfig) {
    this.app = new App({
      token: config.slackBotToken,
      appToken: config.slackAppToken,
      socketMode: true,
      // deferInitialization prevents the Bolt App constructor from making a
      // construct-time auth.test() network call. start() calls app.init()
      // before app.start() to run the deferred initialization at the right time.
      deferInitialization: true,
    });
    this.wire();
  }

  onMessage(handler: (m: InboundMessage) => void): void {
    this.msgHandler = handler;
  }

  onConsentResponse(handler: (r: ConsentResponse) => void): void {
    this.consentHandler = handler;
  }

  async start(): Promise<void> {
    // init() runs the deferred auth.test() that was skipped in the constructor
    // (because deferInitialization:true); start() throws if init() was not called.
    await this.app.init();
    await this.app.start();
  }

  async stop(): Promise<void> {
    await this.app.stop();
  }

  private route(conversationId: string): Route {
    const r = this.routes.get(conversationId);
    if (!r) throw new Error(`No Slack route recorded for conversation ${conversationId}`);
    return r;
  }

  private async postStatus(conversationId: string, status: string): Promise<void> {
    const r = this.routes.get(conversationId);
    // Status requires a thread; the /peek slash path has none — skip there.
    if (!r || !r.threadTs) return;
    try {
      await this.app.client.assistant.threads.setStatus({
        channel_id: r.channel,
        thread_ts: r.threadTs,
        status,
      });
    } catch {
      // Status is a nicety; a failure (e.g. missing chat:write scope on an
      // un-migrated app) must never break the turn. Swallow.
    }
  }

  private async post(conversationId: string, blocks: unknown): Promise<void> {
    const r = this.route(conversationId);
    await this.app.client.chat.postMessage({
      channel: r.channel,
      ...(r.threadTs ? { thread_ts: r.threadTs } : {}),
      // biome-ignore lint/suspicious/noExplicitAny: Bolt's postMessage accepts KnownBlock[] but its typings require `any[]` here
      blocks: blocks as any,
      text: 'peek',
    });
  }

  async postText(conversationId: string, text: string): Promise<void> {
    await this.post(conversationId, resultBlocks(text));
  }

  async postConfirmation(conversationId: string, text: string): Promise<void> {
    await this.post(conversationId, confirmation(text));
  }

  async postError(
    conversationId: string,
    err: { kind: string; headline: string; hint: string },
  ): Promise<void> {
    const r = this.route(conversationId);
    await this.app.client.chat.postMessage({
      channel: r.channel,
      ...(r.threadTs ? { thread_ts: r.threadTs } : {}),
      // biome-ignore lint/suspicious/noExplicitAny: Bolt's postMessage accepts KnownBlock[] but its typings require `any[]` here
      blocks: errorBlock(err.headline, err.hint) as any,
      text: err.headline, // meaningful mobile push
    });
  }

  async postConsentRequest(conversationId: string, req: ConsentRequest): Promise<void> {
    const { blocks } = consentCard(req.summary, req.details, req.correlationId, conversationId);
    await this.post(conversationId, blocks);
  }

  private emit(
    conversationId: string,
    channel: string,
    threadTs: string | undefined,
    userId: string,
    text: string,
  ): void {
    this.routes.set(conversationId, { channel, threadTs });
    // Show a "thinking…" status immediately; Slack auto-clears it when the next
    // message posts (postText/postConsentRequest). Fire-and-forget — never awaited,
    // never allowed to block or throw into the message handler.
    void this.postStatus(conversationId, 'peek is thinking…');
    this.msgHandler?.({ conversationId, userId, text });
  }

  private wire(): void {
    const assistant = new Assistant({
      threadStarted: async ({ say, setSuggestedPrompts }) => {
        await say(
          "Hi — I'm peek. Ask what failed in your last browser session, or tell me to act on the page you have open.",
        );
        const { title, prompts } = suggestedPrompts();
        await setSuggestedPrompts({ title, prompts });
      },
      userMessage: async ({ message, setTitle }) => {
        // Bolt types message as GenericMessageEvent but the actual payload has these fields
        const m = message as {
          thread_ts?: string;
          ts: string;
          text?: string;
          user?: string;
          channel?: string;
        };
        if (!m.text || !m.channel) return;
        // Thread title is a nicety; never block the message on it.
        try {
          await setTitle(m.text.slice(0, 75));
        } catch {
          // Title failure must never drop the user's message.
        }
        const cid = m.thread_ts ?? m.ts;
        this.emit(cid, m.channel, cid, m.user ?? 'unknown', m.text);
      },
    });
    this.app.assistant(assistant);

    this.app.event('app_mention', async ({ event, context }) => {
      const e = event as {
        text?: string;
        ts: string;
        thread_ts?: string;
        user?: string;
        channel: string;
      };
      const botId = context.botUserId ?? '';
      const query = e.text ? stripMention(e.text, botId) : '';
      if (!query || !e.channel) return;
      const cid = e.thread_ts ?? e.ts;
      this.#activeThreads.add(cid);
      this.emit(cid, e.channel, cid, e.user ?? 'unknown', query);
    });

    this.app.message(async ({ message, context }) => {
      const m = message as {
        thread_ts?: string;
        ts: string;
        text?: string;
        subtype?: string;
        user?: string;
        channel?: string;
        channel_type?: string;
      };
      if (m.subtype || !m.text || !m.channel) return;
      const botId = context.botUserId ?? '';
      if (botId && m.text.includes(`<@${botId}>`)) return; // mentions handled by app_mention (dedupe)
      const isDM = m.channel_type === 'im';
      const inActiveThread = m.thread_ts !== undefined && this.#activeThreads.has(m.thread_ts);
      if (!isDM && !inActiveThread) return; // ignore unrelated channel chatter
      const cid = m.thread_ts ?? m.ts;
      if (inActiveThread) this.#activeThreads.add(cid);
      this.emit(cid, m.channel, cid, m.user ?? 'unknown', m.text);
    });

    this.app.command('/peek', async ({ command, ack }) => {
      await ack();
      const cid = `cmd-${command.channel_id}-${command.user_id}`;
      this.emit(cid, command.channel_id, undefined, command.user_id, command.text);
    });

    for (const [actionId, decision] of [
      ['peek_approve', 'approve'],
      ['peek_deny', 'deny'],
    ] as Array<[string, 'approve' | 'deny']>) {
      this.app.action<BlockAction>(actionId, async ({ ack, body }) => {
        await ack();
        // body.actions[0].value holds the JSON-encoded correlationId+conversationId
        // BlockElementAction is a union that lacks a shared `value` field — cast to access it
        const raw = (body.actions[0] as { value?: string } | undefined)?.value;
        const parsed = parseConsentValue(raw);
        if (!parsed) return;
        const channel = body.channel?.id ?? this.routes.get(parsed.conversationId)?.channel;
        // container is StringIndexed — dot notation satisfies biome useLiteralKeys
        const threadTs =
          (body.container.thread_ts as string | undefined) ??
          (body.message?.thread_ts as string | undefined) ??
          this.routes.get(parsed.conversationId)?.threadTs;
        if (channel) this.routes.set(parsed.conversationId, { channel, threadTs });
        this.consentHandler?.({
          conversationId: parsed.conversationId,
          correlationId: parsed.correlationId,
          decision,
        });
      });
    }
  }
}
