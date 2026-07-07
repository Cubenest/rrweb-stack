import type { SecretStore } from '@peekdev/connector-core';

export interface SlackConfig {
  slackBotToken: string;
  slackAppToken: string;
}

export interface ResolveSlackTokensDeps {
  store: SecretStore;
  env: NodeJS.ProcessEnv;
  isTTY: boolean;
  prompt: (label: string) => Promise<string>;
}

const CONNECTOR_ID = 'peek-slack';

interface TokenSpec {
  name: string;
  envVar: string;
  label: string;
}

const TOKEN_SPECS: [TokenSpec, TokenSpec] = [
  { name: 'slack-bot', envVar: 'SLACK_BOT_TOKEN', label: 'Slack bot token (xoxb-…)' },
  { name: 'slack-app', envVar: 'SLACK_APP_TOKEN', label: 'Slack app token (xapp-…)' },
];

async function resolveOne(deps: ResolveSlackTokensDeps, spec: TokenSpec): Promise<string> {
  const stored = await deps.store.get(CONNECTOR_ID, spec.name);
  if (stored) return stored;
  const fromEnv = deps.env[spec.envVar];
  if (fromEnv) return fromEnv;
  if (deps.isTTY) {
    const v = await deps.prompt(spec.label);
    await deps.store.set(CONNECTOR_ID, spec.name, v);
    return v;
  }
  throw new Error(
    `${spec.envVar} not found in keychain or env. Run the connector once interactively to capture it, or set the ${spec.envVar} env var.`,
  );
}

export async function resolveSlackTokens(deps: ResolveSlackTokensDeps): Promise<SlackConfig> {
  // Resolve sequentially so prompts do not interleave
  const slackBotToken = await resolveOne(deps, TOKEN_SPECS[0]);
  const slackAppToken = await resolveOne(deps, TOKEN_SPECS[1]);
  return { slackBotToken, slackAppToken };
}
