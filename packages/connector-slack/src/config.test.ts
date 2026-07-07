import type { SecretStore } from '@peekdev/connector-core';
import { describe, expect, it, vi } from 'vitest';
import { resolveSlackTokens } from './config.js';

// ---------- helpers ----------

function makeStore(
  initial: Record<string, string> = {},
): SecretStore & { sets: Array<[string, string, string]> } {
  const map = new Map(Object.entries(initial));
  const sets: Array<[string, string, string]> = [];
  return {
    sets,
    async get(connectorId: string, name: string): Promise<string | null> {
      return map.get(`${connectorId}:${name}`) ?? null;
    },
    async set(connectorId: string, name: string, secret: string): Promise<void> {
      sets.push([connectorId, name, secret]);
      map.set(`${connectorId}:${name}`, secret);
    },
    async delete(connectorId: string, name: string): Promise<void> {
      map.delete(`${connectorId}:${name}`);
    },
  };
}

const BOT_KEY = 'peek-slack:slack-bot';
const APP_KEY = 'peek-slack:slack-app';

// ---------- tests ----------

describe('resolveSlackTokens', () => {
  it('returns stored tokens; prompt and env NOT consulted', async () => {
    const store = makeStore({ [BOT_KEY]: 'xoxb-stored', [APP_KEY]: 'xapp-stored' });
    const env: NodeJS.ProcessEnv = { SLACK_BOT_TOKEN: 'xoxb-env', SLACK_APP_TOKEN: 'xapp-env' };
    const prompt = vi.fn<(label: string) => Promise<string>>();

    const result = await resolveSlackTokens({ store, env, isTTY: false, prompt });

    expect(result).toEqual({ slackBotToken: 'xoxb-stored', slackAppToken: 'xapp-stored' });
    expect(prompt).not.toHaveBeenCalled();
    expect(store.sets).toHaveLength(0);
  });

  it('returns env values when store is empty; store.set and prompt NOT called', async () => {
    const store = makeStore();
    const env: NodeJS.ProcessEnv = { SLACK_BOT_TOKEN: 'xoxb-env', SLACK_APP_TOKEN: 'xapp-env' };
    const prompt = vi.fn<(label: string) => Promise<string>>();

    const result = await resolveSlackTokens({ store, env, isTTY: false, prompt });

    expect(result).toEqual({ slackBotToken: 'xoxb-env', slackAppToken: 'xapp-env' });
    expect(prompt).not.toHaveBeenCalled();
    expect(store.sets).toHaveLength(0);
  });

  it('prompts per token and stores each when store+env empty and isTTY:true', async () => {
    const store = makeStore();
    const env: NodeJS.ProcessEnv = {};
    const prompt = vi
      .fn<(label: string) => Promise<string>>()
      .mockResolvedValueOnce('xoxb-captured')
      .mockResolvedValueOnce('xapp-captured');

    const result = await resolveSlackTokens({ store, env, isTTY: true, prompt });

    expect(result).toEqual({ slackBotToken: 'xoxb-captured', slackAppToken: 'xapp-captured' });
    expect(prompt).toHaveBeenCalledTimes(2);
    expect(store.sets).toEqual([
      ['peek-slack', 'slack-bot', 'xoxb-captured'],
      ['peek-slack', 'slack-app', 'xapp-captured'],
    ]);
  });

  it('rejects with SLACK_BOT_TOKEN hint and does not prompt when non-TTY', async () => {
    const store = makeStore();
    const env: NodeJS.ProcessEnv = {};
    const prompt = vi.fn<(label: string) => Promise<string>>();

    await expect(resolveSlackTokens({ store, env, isTTY: false, prompt })).rejects.toThrow(
      /SLACK_BOT_TOKEN.*interactively|interactively.*SLACK_BOT_TOKEN/,
    );
    expect(prompt).not.toHaveBeenCalled();
  });

  it('mixed: bot from store, app from env; no set, no prompt', async () => {
    const store = makeStore({ [BOT_KEY]: 'xoxb-stored' });
    const env: NodeJS.ProcessEnv = { SLACK_APP_TOKEN: 'xapp-env' };
    const prompt = vi.fn<(label: string) => Promise<string>>();

    const result = await resolveSlackTokens({ store, env, isTTY: false, prompt });

    expect(result).toEqual({ slackBotToken: 'xoxb-stored', slackAppToken: 'xapp-env' });
    expect(prompt).not.toHaveBeenCalled();
    expect(store.sets).toHaveLength(0);
  });
});
