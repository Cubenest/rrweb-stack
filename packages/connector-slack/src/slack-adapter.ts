import { readFile } from 'node:fs/promises';
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
import { isJourneyCausalChain, journeyBlocks, journeyMarkdown } from './journey.js';

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
  return text.replaceAll(`<@${botUserId}>`, ' ').replace(/\s+/g, ' ').trim();
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
  readonly #MAX_ACTIVE_THREADS = 1000;

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

  async postFile(
    conversationId: string,
    filePath: string,
    filename: string,
    comment?: string,
  ): Promise<void> {
    const r = this.route(conversationId);
    const file = await readFile(filePath);
    // files.uploadV2 uses a discriminated union on thread_ts (exactOptionalPropertyTypes):
    //   FileThreadDestinationArgument — channel_id required + thread_ts required (string)
    //   FileChannelDestinationArgument — channel_id optional + thread_ts must be ABSENT (never)
    // We must not spread a maybe-undefined thread_ts; branch explicitly so each call
    // path satisfies exactly one union arm with no optional keys in the wrong positions.
    if (r.threadTs !== undefined) {
      await this.app.client.files.uploadV2({
        channel_id: r.channel,
        thread_ts: r.threadTs,
        file,
        filename,
        ...(comment !== undefined ? { initial_comment: comment } : {}),
      });
    } else {
      await this.app.client.files.uploadV2({
        channel_id: r.channel,
        file,
        filename,
        ...(comment !== undefined ? { initial_comment: comment } : {}),
      });
    }
  }

  async renderJourney(conversationId: string, journey: unknown): Promise<string> {
    const r = this.route(conversationId);
    if (!isJourneyCausalChain(journey)) {
      throw new Error('renderJourney: journey is not a valid CausalChain');
    }

    const markdown = journeyMarkdown(journey);
    const title = `Session journey — ${journey.error.level.toUpperCase()}: ${journey.error.message.slice(0, 60)}`;

    // Primary path: create a channel-linked Slack canvas.
    // conversations.canvases.create({ channel_id, title, document_content }) creates a canvas
    // that channel members can see and open. Returns { canvas_id } (no URL field in the API).
    // On any canvas error (free team, canvas_disabled_user_team, etc.) fall back to Block Kit.
    let canvasId: string | undefined;
    try {
      const result = await this.app.client.conversations.canvases.create({
        channel_id: r.channel,
        title,
        document_content: { type: 'markdown', markdown },
      });
      canvasId = result.canvas_id;
    } catch (err) {
      console.warn('[peek/connector-slack] canvas unavailable:', err);
      // Canvas unavailable — fall through to Block Kit fallback
    }

    if (canvasId !== undefined) {
      // Resolve the permalink via files.info so we can post a clickable mrkdwn link.
      // The conversations.canvases.create response has canvas_id only (no URL).
      let permalink: string | undefined;
      try {
        const info = await this.app.client.files.info({ file: canvasId });
        permalink = info.file?.permalink;
      } catch (err) {
        console.warn('[peek/connector-slack] files.info failed for canvas permalink:', err);
      }

      // Only post a canvas confirmation if we have a clickable link.
      // A bare canvas_id is NOT openable — treat a missing permalink as canvas-failure
      // and fall through to the Block Kit summary below (never post a dead id).
      if (permalink) {
        const text = `🗺 Session journey canvas created. <${permalink}|Session journey>`;
        // Guard the confirmation post: a Slack API error here must not throw out of
        // renderJourney. On failure, fall through to the Block Kit fallback below so
        // the team still gets the journey.
        try {
          await this.app.client.chat.postMessage({
            channel: r.channel,
            ...(r.threadTs !== undefined ? { thread_ts: r.threadTs } : {}),
            // biome-ignore lint/suspicious/noExplicitAny: Bolt's postMessage accepts KnownBlock[] but its typings require `any[]` here
            blocks: confirmation(text) as any,
            text,
          });
          return permalink;
        } catch (err) {
          console.warn(
            '[peek/connector-slack] canvas confirmation post failed — using Block Kit fallback:',
            err,
          );
          // fall through to the Block Kit fallback
        }
      } else {
        console.warn(
          '[peek/connector-slack] canvas created but no permalink resolved — using Block Kit fallback',
        );
      }
    }

    // Fallback: Block Kit timeline summary posted directly to the thread. Guard the
    // post so a Slack API error never throws out of renderJourney — the caller
    // (connector-core) treats renderJourney as total.
    const fallbackBlocks = journeyBlocks(journey);
    try {
      await this.app.client.chat.postMessage({
        channel: r.channel,
        ...(r.threadTs !== undefined ? { thread_ts: r.threadTs } : {}),
        // biome-ignore lint/suspicious/noExplicitAny: Bolt's postMessage accepts KnownBlock[] but its typings require `any[]` here
        blocks: fallbackBlocks as any,
        text: 'Session journey (canvas unavailable — showing summary)',
      });
      return 'Session journey posted as a message (Slack canvas unavailable on this workspace).';
    } catch (err) {
      console.warn('[peek/connector-slack] Block Kit fallback post failed:', err);
      return 'Session journey is ready, but posting it to Slack failed.';
    }
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

  #trackThread(cid: string): void {
    // Bounded to avoid unbounded growth on a long-running socket process.
    // Simple insertion-order eviction (oldest first); a TTL is deferred past alpha.
    if (this.#activeThreads.size >= this.#MAX_ACTIVE_THREADS && !this.#activeThreads.has(cid)) {
      const oldest = this.#activeThreads.values().next().value;
      if (oldest !== undefined) this.#activeThreads.delete(oldest);
    }
    this.#activeThreads.add(cid);
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
      this.#trackThread(cid);
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
      const isDM = m.channel_type === 'im';
      // Dedupe only in channels: a channel mention fires BOTH app_mention and message,
      // so skip it here (app_mention handles it). DMs never emit app_mention, so a DM
      // whose text contains a mention token must NOT be dropped.
      if (!isDM && botId && m.text.includes(`<@${botId}>`)) return;
      const inActiveThread = m.thread_ts !== undefined && this.#activeThreads.has(m.thread_ts);
      if (!isDM && !inActiveThread) return; // ignore unrelated channel chatter
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
