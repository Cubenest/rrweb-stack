import assert from 'node:assert/strict';
import { test } from 'node:test';
import { checkClientConfig } from './check-client-config.mjs';

const json = (obj) => `\`\`\`json\n${JSON.stringify(obj, null, 2)}\n\`\`\``;
const toml = (s) => `\`\`\`toml\n${s}\n\`\`\``;
const CANON = { command: 'npx', args: ['-y', '@peekdev/mcp@latest'] };

test('vscode recipe with the servers root passes', () => {
  assert.deepEqual(checkClientConfig(['vscode'], json({ servers: { peek: CANON } })), []);
});
test('vscode recipe using mcpServers errors (the bug we are guarding)', () => {
  const issues = checkClientConfig(['vscode'], json({ mcpServers: { peek: CANON } }));
  assert.equal(issues.length, 1);
  assert.match(issues[0].detail, /requires "servers"/);
});
test('non-vscode recipe with mcpServers passes', () => {
  assert.deepEqual(checkClientConfig(['cursor'], json({ mcpServers: { peek: CANON } })), []);
});
test('codex TOML passes', () => {
  assert.deepEqual(
    checkClientConfig(
      ['codex'],
      toml('[mcp_servers.peek]\ncommand = "npx"\nargs = ["-y", "@peekdev/mcp@latest"]'),
    ),
    [],
  );
});
test('malformed TOML errors (fail closed)', () => {
  const issues = checkClientConfig(['codex'], toml('[mcp_servers.peek\ncommand ='));
  assert.equal(issues.length, 1);
  assert.match(issues[0].detail, /malformed TOML/i);
});
test('non-canonical args error', () => {
  const issues = checkClientConfig(
    ['cursor'],
    json({ mcpServers: { peek: { command: 'npx', args: ['-y', '@peekdev/mcp'] } } }),
  );
  assert.equal(issues.length, 1);
});
test('a recipe with no peek config fence is a no-op', () => {
  assert.deepEqual(
    checkClientConfig(['claude-code'], '## Using peek\n\nSome prose, no fences.'),
    [],
  );
});
// Malformed JSON is intentionally fail-OPEN here: this validator only checks the
// peek block's SHAPE, and the separate `checkJsonBlocks` check in verify-recipes.mjs
// is the JSON-parse gate that reports a malformed fence. So an unparseable JSON fence
// returns [] from checkClientConfig (no double-report) — locked in below. (TOML has no
// such sibling gate, hence TOML is fail-closed above.)
test('malformed JSON is fail-open (delegated to the checkJsonBlocks parse gate)', () => {
  const body = '```json\n{ "mcpServers": { "peek": { broken,, } }\n```';
  assert.deepEqual(checkClientConfig(['cursor'], body), []);
});
test('a jsonc fence with comments is skipped (JSON.parse cannot read it)', () => {
  const body = '```jsonc\n{\n  // peek server\n  "mcpServers": { "peek": ' + JSON.stringify(CANON) + ' }\n}\n```';
  // Comments make JSON.parse throw → the fence is skipped (no false error). No recipe
  // uses jsonc-with-comments today; this documents the current behavior.
  assert.deepEqual(checkClientConfig(['cursor'], body), []);
});
