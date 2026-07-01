import { isDeepStrictEqual } from 'node:util';

const REQUIRED_PLUGIN_FIELDS = [
  'description',
  'author',
  'homepage',
  'repository',
  'license',
  'keywords',
];

/** Validate the repo-root marketplace manifest. */
export function checkMarketplace(mp) {
  const issues = [];
  if (!mp || mp.name !== 'peek') {
    issues.push({
      severity: 'error',
      detail: `marketplace.json: name must be "peek" (got ${JSON.stringify(mp?.name)})`,
    });
  }
  if (!mp?.owner?.name) {
    issues.push({ severity: 'error', detail: 'marketplace.json: owner.name is required' });
  }
  const entry = Array.isArray(mp?.plugins) ? mp.plugins.find((p) => p?.name === 'peek') : undefined;
  if (!entry) {
    issues.push({ severity: 'error', detail: 'marketplace.json: no plugins[] entry named "peek"' });
  } else if (entry.source !== './plugins/peek') {
    issues.push({
      severity: 'error',
      detail: `marketplace.json: peek source must be "./plugins/peek" (got ${JSON.stringify(entry.source)})`,
    });
  }
  return issues;
}

/** Validate the plugin manifest shape + discovery metadata. */
export function checkPluginManifest(pm) {
  const issues = [];
  if (!pm || pm.name !== 'peek') {
    issues.push({
      severity: 'error',
      detail: `plugin.json: name must be "peek" (got ${JSON.stringify(pm?.name)})`,
    });
  }
  if (typeof pm?.version !== 'string' || pm.version.length === 0) {
    issues.push({ severity: 'error', detail: 'plugin.json: version must be a non-empty string' });
  }
  for (const field of REQUIRED_PLUGIN_FIELDS) {
    if (pm?.[field] === undefined) {
      issues.push({
        severity: 'error',
        detail: `plugin.json: missing required metadata field "${field}"`,
      });
    }
  }
  if (pm?.mcpServers !== './.mcp.json') {
    issues.push({
      severity: 'error',
      detail: `plugin.json: mcpServers must be "./.mcp.json" (got ${JSON.stringify(pm?.mcpServers)})`,
    });
  }
  return issues;
}

/** The plugin's peek MCP block must equal the repo-root one AND ship only peek. */
export function checkMcpParity(pluginMcp, rootMcp) {
  const issues = [];
  const pluginServers = pluginMcp?.mcpServers ?? {};
  const keys = Object.keys(pluginServers);
  if (keys.length !== 1 || keys[0] !== 'peek') {
    issues.push({
      severity: 'error',
      detail: `plugin .mcp.json must contain ONLY the "peek" server (got ${JSON.stringify(keys)})`,
    });
  }
  const pluginPeek = pluginServers.peek;
  const rootPeek = rootMcp?.mcpServers?.peek;
  if (!isDeepStrictEqual(pluginPeek, rootPeek)) {
    issues.push({
      severity: 'error',
      detail: `plugin .mcp.json peek block must match the repo-root .mcp.json peek block (plugin=${JSON.stringify(pluginPeek)} root=${JSON.stringify(rootPeek)})`,
    });
  }
  return issues;
}

/** The bundled skill must be byte-identical to the canonical peek-skill.md. */
export function checkSkillSync(pluginSkill, canonicalSkill) {
  if (pluginSkill === canonicalSkill) {
    return [];
  }
  return [
    {
      severity: 'error',
      detail:
        'plugins/peek/skills/peek/SKILL.md is not byte-identical to packages/peek-cli/skills/peek-skill.md — re-copy it (cp packages/peek-cli/skills/peek-skill.md plugins/peek/skills/peek/SKILL.md)',
    },
  ];
}
