import { describe, expect, it } from 'vitest';
import { loadBrainConfig, loadMcpConfig } from './config.js';
import { assertNodeVersion } from './node-version.js';

describe('loadMcpConfig', () => {
  it('defaults the spawn command and splits args', () => {
    const c = loadMcpConfig({});
    expect(c.command).toBe('npx');
    expect(c.args).toEqual(['-y', '@peekdev/mcp@latest']);
  });
  it('honors PEEK_MCP_COMMAND', () => {
    const c = loadMcpConfig({ PEEK_MCP_COMMAND: 'node ./server.js' });
    expect(c.command).toBe('node');
    expect(c.args).toEqual(['./server.js']);
  });
});

describe('loadBrainConfig', () => {
  it('throws when ANTHROPIC_API_KEY is missing', () => {
    expect(() => loadBrainConfig({})).toThrow(/ANTHROPIC_API_KEY/);
  });
  it('defaults to Opus natively and Sonnet slug via a gateway base URL', () => {
    expect(loadBrainConfig({ ANTHROPIC_API_KEY: 'k' }).model).toBe('claude-opus-4-8');
    const g = loadBrainConfig({
      ANTHROPIC_API_KEY: 'k',
      ANTHROPIC_BASE_URL: 'https://openrouter.ai/api',
    });
    expect(g.model).toBe('anthropic/claude-sonnet-4.5');
    expect(g.anthropicBaseURL).toBe('https://openrouter.ai/api');
  });
});

describe('assertNodeVersion', () => {
  it('throws below 22', () => {
    expect(() => assertNodeVersion('v20.1.0')).toThrow(/Node 22/);
  });
  it('passes at 22+', () => {
    expect(() => assertNodeVersion('v22.0.0')).not.toThrow();
  });
});
