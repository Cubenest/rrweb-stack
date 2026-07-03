import type { McpSpawn } from './mcp.js';

export interface BrainConfig {
  anthropicApiKey: string;
  anthropicBaseURL: string | undefined;
  model: string;
}

function required(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name];
  if (!value) throw new Error(`Missing required env var: ${name}`);
  return value;
}

export function loadMcpConfig(env: NodeJS.ProcessEnv): McpSpawn {
  const command = env.PEEK_MCP_COMMAND || 'npx -y @peekdev/mcp@latest';
  const parts = command.split(' ');
  const cmd = parts[0] ?? 'npx';
  const args = parts.slice(1);
  return { command: cmd, args };
}

export function loadBrainConfig(env: NodeJS.ProcessEnv): BrainConfig {
  const anthropicBaseURL = env.ANTHROPIC_BASE_URL || undefined;
  const defaultModel = anthropicBaseURL ? 'anthropic/claude-sonnet-4.5' : 'claude-opus-4-8';
  return {
    anthropicApiKey: required(env, 'ANTHROPIC_API_KEY'),
    anthropicBaseURL,
    model: env.ANTHROPIC_MODEL ?? defaultModel,
  };
}
