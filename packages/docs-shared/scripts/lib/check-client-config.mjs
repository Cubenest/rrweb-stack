import { parse as parseToml } from 'smol-toml';

const JSON_BLOCK = /```(?:json|jsonc)\n([\s\S]*?)```/g;
const TOML_BLOCK = /```toml\n([\s\S]*?)```/g;

/** VS Code's .vscode/mcp.json uses `servers`; every other peek-supported client uses `mcpServers`. */
function expectedJsonRootKey(integrations) {
  return integrations.includes('vscode') ? 'servers' : 'mcpServers';
}

function assertCanonical(entry, fmt, issues) {
  const okCommand = entry && entry.command === 'npx';
  const okArgs =
    entry &&
    Array.isArray(entry.args) &&
    entry.args[0] === '-y' &&
    entry.args[1] === '@peekdev/mcp@latest';
  if (!okCommand || !okArgs) {
    issues.push({
      severity: 'error',
      detail: `non-canonical peek MCP entry (${fmt}): ${JSON.stringify(entry)} (expected { command: "npx", args: ["-y", "@peekdev/mcp@latest"] })`,
    });
  }
}

/**
 * Validate every peek MCP config fence in a recipe body against the client's
 * TRUE schema: the correct JSON root key per client (servers for VS Code,
 * mcpServers otherwise) + the Codex TOML shape. Returns {severity, detail}[].
 */
export function checkClientConfig(integrations, body) {
  const issues = [];
  const rootKey = expectedJsonRootKey(integrations);
  const otherKey = rootKey === 'servers' ? 'mcpServers' : 'servers';

  for (const m of body.matchAll(JSON_BLOCK)) {
    const raw = m[1];
    if (!/peek/i.test(raw)) continue;
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      continue;
    }
    const underExpected = parsed?.[rootKey]?.peek;
    const underOther = parsed?.[otherKey]?.peek;
    const topLevel = parsed?.peek;
    if (!underExpected && underOther) {
      issues.push({
        severity: 'error',
        detail: `peek MCP block uses "${otherKey}" but this client (${integrations.join(', ') || 'unknown'}) requires "${rootKey}"`,
      });
      continue;
    }
    const entry = underExpected ?? topLevel;
    if (!entry) continue;
    assertCanonical(entry, 'json', issues);
  }

  for (const m of body.matchAll(TOML_BLOCK)) {
    const raw = m[1];
    if (!/peek/i.test(raw)) continue;
    let parsed;
    try {
      parsed = parseToml(raw);
    } catch (e) {
      issues.push({ severity: 'error', detail: `malformed TOML peek MCP config: ${e.message}` });
      continue;
    }
    const entry = parsed?.mcp_servers?.peek;
    if (!entry) continue;
    assertCanonical(entry, 'toml', issues);
  }

  return issues;
}
