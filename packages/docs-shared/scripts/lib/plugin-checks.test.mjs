import assert from 'node:assert/strict';
import { test } from 'node:test';
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

test('checkMarketplace passes a well-formed marketplace', () => {
  assert.deepEqual(checkMarketplace(goodMarketplace), []);
});
test('checkMarketplace flags a wrong marketplace name', () => {
  assert.ok(
    checkMarketplace({ ...goodMarketplace, name: 'nope' }).some((i) => i.severity === 'error'),
  );
});
test('checkMarketplace flags a missing/incorrect plugin source', () => {
  assert.ok(
    checkMarketplace({ ...goodMarketplace, plugins: [{ name: 'peek', source: './wrong' }] }).some(
      (i) => i.severity === 'error',
    ),
  );
});
test('checkMarketplace does not throw on a malformed plugins[] element', () => {
  assert.ok(
    checkMarketplace({ ...goodMarketplace, plugins: [null] }).some((i) => i.severity === 'error'),
  );
});

test('checkPluginManifest passes a well-formed manifest', () => {
  assert.deepEqual(checkPluginManifest(goodPlugin), []);
});
test('checkPluginManifest flags a missing version', () => {
  const { version, ...noVersion } = goodPlugin;
  assert.ok(checkPluginManifest(noVersion).some((i) => i.severity === 'error'));
});
test('checkPluginManifest flags a missing metadata field (license)', () => {
  const { license, ...noLicense } = goodPlugin;
  assert.ok(checkPluginManifest(noLicense).some((i) => i.severity === 'error'));
});
test('checkPluginManifest flags mcpServers not pointing at ./.mcp.json', () => {
  assert.ok(
    checkPluginManifest({ ...goodPlugin, mcpServers: { peek: canonicalPeek } }).some(
      (i) => i.severity === 'error',
    ),
  );
});

test('checkMcpParity passes when the plugin peek block matches root and has only peek', () => {
  const rootMcp = {
    mcpServers: { peek: canonicalPeek, 'peek-dev': { command: 'node', args: ['x'] } },
  };
  assert.deepEqual(checkMcpParity({ mcpServers: { peek: canonicalPeek } }, rootMcp), []);
});
test('checkMcpParity flags a divergent peek block', () => {
  const rootMcp = { mcpServers: { peek: canonicalPeek } };
  const drift = { mcpServers: { peek: { command: 'npx', args: ['-y', '@peekdev/mcp@1.0.0'] } } };
  assert.ok(checkMcpParity(drift, rootMcp).some((i) => i.severity === 'error'));
});
test('checkMcpParity flags a shipped dev entry', () => {
  const rootMcp = {
    mcpServers: { peek: canonicalPeek, 'peek-dev': { command: 'node', args: ['x'] } },
  };
  const withDev = {
    mcpServers: { peek: canonicalPeek, 'peek-dev': { command: 'node', args: ['x'] } },
  };
  assert.ok(checkMcpParity(withDev, rootMcp).some((i) => i.severity === 'error'));
});
test('checkMcpParity is key-order-insensitive for the peek block', () => {
  const rootMcp = { mcpServers: { peek: { command: 'npx', args: ['-y', '@peekdev/mcp@latest'] } } };
  const reordered = {
    mcpServers: { peek: { args: ['-y', '@peekdev/mcp@latest'], command: 'npx' } },
  };
  assert.deepEqual(checkMcpParity(reordered, rootMcp), []);
});

test('checkSkillSync passes identical content', () => {
  assert.deepEqual(checkSkillSync('same\n', 'same\n'), []);
});
test('checkSkillSync flags any drift', () => {
  assert.ok(checkSkillSync('a\n', 'b\n').some((i) => i.severity === 'error'));
});
