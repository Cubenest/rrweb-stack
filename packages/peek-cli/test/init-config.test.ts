import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  CLIENTS,
  type ClientId,
  PEEK_BLOCK_SNIPPET,
  PEEK_MCP_BLOCK,
  clientConfigPath,
  containsJsonComments,
  detectClients,
  hasPeekServer,
  mergePeekConfig,
  serializeConfig,
} from '../src/lib/init-config.js';

const HOME = '/home/dev';
const CWD = '/work/project';

describe('clientConfigPath', () => {
  it('resolves the documented §K.5 paths', () => {
    const byId = new Map(CLIENTS.map((c) => [c.id, c] as const));
    const path = (id: ClientId) =>
      clientConfigPath(byId.get(id) as (typeof CLIENTS)[number], HOME, CWD);
    // Derive expectations via join() so the assertions hold on Windows (\) too;
    // clientConfigPath joins with the host separator (correct on each OS).
    expect(path('claude-code')).toBe(join(HOME, '.claude.json'));
    expect(path('cursor')).toBe(join(HOME, '.cursor', 'mcp.json'));
    expect(path('vscode')).toBe(join(CWD, '.vscode', 'mcp.json'));
    expect(path('windsurf')).toBe(join(HOME, '.codeium', 'windsurf', 'mcp_config.json'));
    expect(path('cline')).toBe(join(HOME, 'cline_mcp_settings.json'));
  });

  it('resolves VS Code relative to cwd (project scope), others to home', () => {
    const vscode = CLIENTS.find((c) => c.id === 'vscode');
    expect(vscode?.scope).toBe('project');
  });

  it('marks Cline as manualOnly', () => {
    const cline = CLIENTS.find((c) => c.id === 'cline');
    expect(cline?.manualOnly).toBe(true);
  });
});

describe('detectClients', () => {
  it('reports exists per the injected fileExists probe', () => {
    const present = new Set([join(HOME, '.claude.json'), join(CWD, '.vscode', 'mcp.json')]);
    const detected = detectClients(HOME, CWD, (p) => present.has(p));
    const byId = new Map(detected.map((d) => [d.id, d] as const));
    expect(byId.get('claude-code')?.exists).toBe(true);
    expect(byId.get('vscode')?.exists).toBe(true);
    expect(byId.get('cursor')?.exists).toBe(false);
    expect(detected).toHaveLength(CLIENTS.length);
  });
});

describe('mergePeekConfig', () => {
  it('creates a fresh config when none exists', () => {
    const merged = mergePeekConfig(undefined);
    expect(merged).toEqual({
      mcpServers: { peek: { command: 'npx', args: ['-y', '@peekdev/mcp@latest'] } },
    });
  });

  it('preserves a user’s other mcpServers (no clobber)', () => {
    const existing = {
      mcpServers: {
        github: { command: 'npx', args: ['-y', '@modelcontextprotocol/server-github'] },
      },
    };
    const merged = mergePeekConfig(existing);
    const servers = merged.mcpServers as Record<string, unknown>;
    expect(Object.keys(servers).sort()).toEqual(['github', 'peek']);
    expect(servers.github).toEqual(existing.mcpServers.github);
    expect(servers.peek).toEqual({ command: 'npx', args: ['-y', '@peekdev/mcp@latest'] });
  });

  it('carries through non-mcpServers top-level keys', () => {
    const existing = { theme: 'dark', mcpServers: {} };
    const merged = mergePeekConfig(existing);
    expect(merged.theme).toBe('dark');
  });

  it('overwrites a stale peek block with the current one', () => {
    const existing = {
      mcpServers: { peek: { command: 'old', args: ['busted'] } },
    };
    const merged = mergePeekConfig(existing);
    const servers = merged.mcpServers as Record<string, unknown>;
    expect(servers.peek).toEqual({ command: 'npx', args: ['-y', '@peekdev/mcp@latest'] });
  });

  it('does not mutate the input object', () => {
    const existing = { mcpServers: { github: { command: 'x' } } };
    const snapshot = JSON.parse(JSON.stringify(existing));
    mergePeekConfig(existing);
    expect(existing).toEqual(snapshot);
  });

  it('throws on a non-object config', () => {
    expect(() => mergePeekConfig([1, 2, 3])).toThrow(/not a JSON object/);
  });

  it('throws rather than clobber a non-object mcpServers', () => {
    expect(() => mergePeekConfig({ mcpServers: 'oops' })).toThrow(/non-object "mcpServers"/);
  });

  it('emits args as a real mutable array (not the frozen const)', () => {
    const merged = mergePeekConfig(undefined);
    const block = (merged.mcpServers as Record<string, { args: string[] }>).peek;
    expect(Array.isArray(block.args)).toBe(true);
    expect(block.args).not.toBe(PEEK_MCP_BLOCK.args);
  });
});

describe('hasPeekServer', () => {
  it('is true when a peek server is already registered', () => {
    expect(hasPeekServer({ mcpServers: { peek: PEEK_MCP_BLOCK } })).toBe(true);
  });

  it('is false otherwise', () => {
    expect(hasPeekServer(undefined)).toBe(false);
    expect(hasPeekServer({ mcpServers: {} })).toBe(false);
    expect(hasPeekServer({ mcpServers: { github: {} } })).toBe(false);
    expect(hasPeekServer('nope')).toBe(false);
  });
});

describe('containsJsonComments', () => {
  it('detects line comments', () => {
    expect(containsJsonComments('{\n  // peek server\n  "mcpServers": {}\n}')).toBe(true);
  });

  it('detects block comments', () => {
    expect(containsJsonComments('{ /* note */ "mcpServers": {} }')).toBe(true);
  });

  it('is false for plain JSON', () => {
    expect(containsJsonComments('{ "mcpServers": { "peek": {} } }')).toBe(false);
  });

  it('does not false-positive on // inside string values (e.g. URLs)', () => {
    expect(containsJsonComments('{ "url": "https://example.com/x" }')).toBe(false);
  });

  it('does not false-positive on an escaped quote followed by a slash', () => {
    expect(containsJsonComments('{ "a": "he said \\"hi\\"//x" }')).toBe(false);
  });
});

describe('serializeConfig', () => {
  it('pretty-prints with a trailing newline', () => {
    const out = serializeConfig({ mcpServers: {} });
    expect(out.endsWith('\n')).toBe(true);
    expect(JSON.parse(out)).toEqual({ mcpServers: {} });
  });
});

describe('PEEK_BLOCK_SNIPPET', () => {
  it('is the parseable peek mcpServers block', () => {
    const parsed = JSON.parse(PEEK_BLOCK_SNIPPET);
    expect(parsed).toEqual({
      mcpServers: { peek: { command: 'npx', args: ['-y', '@peekdev/mcp@latest'] } },
    });
  });
});
