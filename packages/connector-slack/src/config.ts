function required(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name];
  if (!value) throw new Error(`Missing required env var: ${name}`);
  return value;
}

export interface SlackConfig {
  slackBotToken: string;
  slackAppToken: string;
}

export function loadSlackConfig(env: NodeJS.ProcessEnv): SlackConfig {
  return {
    slackBotToken: required(env, 'SLACK_BOT_TOKEN'),
    slackAppToken: required(env, 'SLACK_APP_TOKEN'),
  };
}
