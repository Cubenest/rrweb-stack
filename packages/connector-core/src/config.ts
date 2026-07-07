import type { McpSpawn } from './mcp.js';

/**
 * LLM credentials + model for the connector's brain.
 *
 * `SdkBrain` speaks the Anthropic Messages API, so `baseURL` may point at any
 * Anthropic-API-compatible endpoint: Anthropic native (leave `baseURL` unset),
 * OpenRouter (routes to GPT / Gemini / Llama / etc.), Ollama's
 * anthropic-compatible endpoint, or LiteLLM in Anthropic mode. The model
 * defaults to Claude but can be any model the chosen endpoint exposes.
 */
export interface BrainConfig {
  apiKey: string;
  baseURL: string | undefined;
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
  const baseURL = env.PEEK_LLM_BASE_URL || undefined;
  const defaultModel = baseURL ? 'anthropic/claude-sonnet-4.5' : 'claude-opus-4-8';
  return {
    apiKey: required(env, 'PEEK_LLM_API_KEY'),
    baseURL,
    model: env.PEEK_LLM_MODEL ?? defaultModel,
  };
}
