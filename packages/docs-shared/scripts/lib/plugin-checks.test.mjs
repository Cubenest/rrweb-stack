import { describe, expect, it } from 'vitest';
import {
  checkMarketplace,
  checkMcpParity,
  checkPluginManifest,
  checkSkillSync,
} from './plugin-checks.mjs';

const goodMarketplace = {
  name: 'peek',
  owner: { name: 'Cubenest' },
  plugins: [{ name: 'peek', source: './plugins/peek' }],
};
const goodPlugin = {
  name: 'peek',
  version: '0.1.0',
  description: 'x'.repeat(60),
  author: { name: 'Cubenest' },
  homepage: 'https://peek.cubenest.in',
  repository: 'https://github.com/Cubenest/rrweb-stack',
  license: 'Apache-2.0',
  keywords: ['mcp'],
  mcpServers: './.mcp.json',
};
const canonicalPeek = { command: 'npx', args: ['-y', '@peekdev/mcp@latest'] };

describe('checkMarketplace', () => {
  it('passes a well-formed marketplace', () => {
    expect(checkMarketplace(goodMarketplace)).toEqual([]);
  });
  it('flags a wrong marketplace name', () => {
    const issues = checkMarketplace({ ...goodMarketplace, name: 'nope' });
    expect(issues.some((i) => i.severity === 'error')).toBe(true);
  });
  it('flags a missing/incorrect plugin source', () => {
    const issues = checkMarketplace({
      ...goodMarketplace,
      plugins: [{ name: 'peek', source: './wrong' }],
    });
    expect(issues.some((i) => i.severity === 'error')).toBe(true);
  });
  it('does not throw on a malformed plugins[] element', () => {
    const issues = checkMarketplace({ ...goodMarketplace, plugins: [null] });
    expect(issues.some((i) => i.severity === 'error')).toBe(true);
  });
});

describe('checkPluginManifest', () => {
  it('passes a well-formed manifest', () => {
    expect(checkPluginManifest(goodPlugin)).toEqual([]);
  });
  it('flags a missing version', () => {
    const { version, ...noVersion } = goodPlugin;
    expect(checkPluginManifest(noVersion).some((i) => i.severity === 'error')).toBe(true);
  });
  it('flags a missing metadata field (license)', () => {
    const { license, ...noLicense } = goodPlugin;
    expect(checkPluginManifest(noLicense).some((i) => i.severity === 'error')).toBe(true);
  });
  it('flags mcpServers not pointing at ./.mcp.json', () => {
    expect(
      checkPluginManifest({ ...goodPlugin, mcpServers: { peek: canonicalPeek } }).some(
        (i) => i.severity === 'error',
      ),
    ).toBe(true);
  });
});

describe('checkMcpParity', () => {
  const rootMcp = {
    mcpServers: { peek: canonicalPeek, 'peek-dev': { command: 'node', args: ['x'] } },
  };
  it('passes when the plugin peek block matches root and has only peek', () => {
    expect(checkMcpParity({ mcpServers: { peek: canonicalPeek } }, rootMcp)).toEqual([]);
  });
  it('flags a divergent peek block', () => {
    const drift = { mcpServers: { peek: { command: 'npx', args: ['-y', '@peekdev/mcp@1.0.0'] } } };
    expect(checkMcpParity(drift, rootMcp).some((i) => i.severity === 'error')).toBe(true);
  });
  it('flags a shipped dev entry', () => {
    const withDev = {
      mcpServers: { peek: canonicalPeek, 'peek-dev': { command: 'node', args: ['x'] } },
    };
    expect(checkMcpParity(withDev, rootMcp).some((i) => i.severity === 'error')).toBe(true);
  });
});

describe('checkSkillSync', () => {
  it('passes identical content', () => {
    expect(checkSkillSync('same\n', 'same\n')).toEqual([]);
  });
  it('flags any drift', () => {
    expect(checkSkillSync('a\n', 'b\n').some((i) => i.severity === 'error')).toBe(true);
  });
});
