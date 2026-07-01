import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  checkMarketplace,
  checkMcpParity,
  checkPluginManifest,
  checkSkillSync,
} from './lib/plugin-checks.mjs';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const readJson = (rel) => JSON.parse(readFileSync(resolve(REPO_ROOT, rel), 'utf8'));
const readText = (rel) => readFileSync(resolve(REPO_ROOT, rel), 'utf8');

const issues = [
  ...checkMarketplace(readJson('.claude-plugin/marketplace.json')),
  ...checkPluginManifest(readJson('plugins/peek/.claude-plugin/plugin.json')),
  ...checkMcpParity(readJson('plugins/peek/.mcp.json'), readJson('.mcp.json')),
  ...checkSkillSync(
    readText('plugins/peek/skills/peek/SKILL.md'),
    readText('packages/peek-cli/skills/peek-skill.md'),
  ),
];

if (issues.length > 0) {
  for (const i of issues) {
    console.error(`[check-plugin] ${i.severity}: ${i.detail}`);
  }
  console.error(`\ncheck-plugin: ${issues.length} issue(s).`);
  process.exit(1);
}
console.log('check-plugin: OK (marketplace + plugin manifest + mcp parity + skill sync).');
