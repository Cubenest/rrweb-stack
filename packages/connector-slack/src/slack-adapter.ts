import type {
  ConsentRequest,
  ConsentResponse,
  InboundMessage,
  SurfaceAdapter,
} from '@peekdev/connector-core';
import { App, Assistant } from '@slack/bolt';
import type { BlockAction } from '@slack/bolt';
import { confirmation, consentCard, textBlocks } from './blockkit.js';
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

  constructor(config: SlackConfig) {
    this.app = new App({
      token: config.slackBotToken,
      appToken: config.slackAppToken,
      socketMode: true,
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
    await this.post(conversationId, textBlocks(text));
  }

  async postConfirmation(conversationId: string, text: string): Promise<void> {
    await this.post(conversationId, confirmation(text));
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
        // Thread title is handler-scoped and safe to set synchronously before emit.
        await setTitle(m.text.slice(0, 75));
        const cid = m.thread_ts ?? m.ts;
        this.emit(cid, m.channel, cid, m.user ?? 'unknown', m.text);
      },
    });
    this.app.assistant(assistant);

    this.app.message(async ({ message }) => {
      // message payload shape — subtype discriminates bot/system messages
      const m = message as {
        thread_ts?: string;
        ts: string;
        text?: string;
        subtype?: string;
        user?: string;
        channel?: string;
      };
      if (m.subtype || !m.text || !m.channel) return;
      const cid = m.thread_ts ?? m.ts;
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
