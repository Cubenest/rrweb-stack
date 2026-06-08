// `peek init` pure core (P2 PRD §K.5): detect MCP-capable clients and compute
// the merged config to write. Everything here is a pure function of (home dir,
// cwd, which clients, possibly-existing config) → result. The interactive
// prompts and the real `fs` reads/writes live in the command shell
// (commands/init.ts), so this logic is exhaustively unit-testable against
// fixtures with pre-existing servers.

import { join } from 'node:path';

/** The MCP server key peek registers under, and the block written for it. */
export const PEEK_SERVER_KEY = 'peek';

/**
 * The `mcpServers.peek` block (P2 PRD §K.1-K.5): `npx -y @peekdev/mcp@latest`.
 *
 * The version tag is load-bearing. `@peekdev/mcp` is published only under
 * prerelease versions (`0.1.0-alpha.*`) while in alpha, and a bare
 * `npx -y @peekdev/mcp` resolves the implicit `*` range, which per semver does
 * NOT match prereleases — npx fails with `ETARGET: No matching version found
 * for @peekdev/mcp@*` and the MCP client reports a connection error. Pinning
 * `@latest` forces the dist-tag (the newest published alpha) so resolution
 * succeeds. Revisit once a stable (non-prerelease) version ships.
 */
export interface PeekMcpServerBlock {
  readonly command: 'npx';
  readonly args: readonly ['-y', '@peekdev/mcp@latest'];
}

export const PEEK_MCP_BLOCK: PeekMcpServerBlock = {
  command: 'npx',
  args: ['-y', '@peekdev/mcp@latest'],
};

/** Stable identifiers for the supported MCP clients. */
export type ClientId = 'claude-code' | 'cursor' | 'vscode' | 'windsurf' | 'cline';

/** Static metadata about one MCP client's config file. */
export interface ClientDescriptor {
  readonly id: ClientId;
  /** Human label shown in the wizard (P2 PRD §K.5). */
  readonly label: string;
  /**
   * Where the config file is resolved. `home`-relative for the per-user
   * clients; `cwd`-relative for the project-scoped ones (VS Code's
   * `.vscode/mcp.json`).
   */
  readonly scope: 'home' | 'project';
  /** Path segments under the scope root, e.g. ['.cursor', 'mcp.json']. */
  readonly pathSegments: readonly string[];
  /**
   * Cline stores its MCP config inside the VS Code extension's globalStorage
   * under an OS-specific path the CLI can't reliably resolve, so the wizard
   * marks it "manual config required" rather than writing blindly (matches the
   * §K.5 transcript). `true` ⇒ detection/merge are advisory only.
   */
  readonly manualOnly?: boolean;
}

/**
 * The five MCP clients from the §K.5 wizard. Cline is `manualOnly` because its
 * `cline_mcp_settings.json` lives in VS Code's per-OS globalStorage (the §K.5
 * transcript shows "manual config required" for it).
 */
export const CLIENTS: readonly ClientDescriptor[] = [
  {
    id: 'claude-code',
    label: 'Claude Code',
    scope: 'home',
    pathSegments: ['.claude.json'],
  },
  {
    id: 'cursor',
    label: 'Cursor',
    scope: 'home',
    pathSegments: ['.cursor', 'mcp.json'],
  },
  {
    id: 'vscode',
    label: 'VS Code',
    scope: 'project',
    pathSegments: ['.vscode', 'mcp.json'],
  },
  {
    id: 'windsurf',
    label: 'Windsurf',
    scope: 'home',
    pathSegments: ['.codeium', 'windsurf', 'mcp_config.json'],
  },
  {
    id: 'cline',
    label: 'Cline',
    scope: 'home',
    pathSegments: ['cline_mcp_settings.json'],
    manualOnly: true,
  },
];

/** Resolve a client's absolute config path given the home dir and cwd. */
export function clientConfigPath(client: ClientDescriptor, homeDir: string, cwd: string): string {
  const root = client.scope === 'home' ? homeDir : cwd;
  return join(root, ...client.pathSegments);
}

/** A client paired with its resolved path and whether the file exists. */
export interface DetectedClient extends ClientDescriptor {
  readonly configPath: string;
  /** True if the config file already exists on disk. */
  readonly exists: boolean;
}

/**
 * Detect which clients have a config present. `fileExists` is injected (the
 * shell passes a real `existsSync`; tests pass a fake) so detection stays pure.
 * Every client is returned with its resolved path + `exists`; the wizard shows
 * detected ones and lets the user pick.
 */
export function detectClients(
  homeDir: string,
  cwd: string,
  fileExists: (path: string) => boolean,
): DetectedClient[] {
  return CLIENTS.map((c) => {
    const configPath = clientConfigPath(c, homeDir, cwd);
    return { ...c, configPath, exists: fileExists(configPath) };
  });
}

/**
 * Merge the peek MCP block into an existing (possibly undefined) parsed config,
 * returning a NEW object (never mutating the input). Any pre-existing
 * `mcpServers` entries are preserved; only the `peek` key is set/overwritten.
 * Non-`mcpServers` top-level keys (e.g. a user's other Claude Code settings)
 * are carried through untouched.
 *
 * Throws if `existing` is present but its `mcpServers` is a non-object (a
 * malformed config the user must fix by hand, rather than us clobbering it).
 */
export function mergePeekConfig(existing: unknown): Record<string, unknown> {
  if (existing === undefined || existing === null) {
    return {
      mcpServers: { [PEEK_SERVER_KEY]: { ...PEEK_MCP_BLOCK, args: [...PEEK_MCP_BLOCK.args] } },
    };
  }
  if (typeof existing !== 'object' || Array.isArray(existing)) {
    throw new Error('existing config is not a JSON object');
  }
  const base = existing as Record<string, unknown>;
  const existingServers = base.mcpServers;
  if (
    existingServers !== undefined &&
    (typeof existingServers !== 'object' ||
      existingServers === null ||
      Array.isArray(existingServers))
  ) {
    throw new Error('existing config has a non-object "mcpServers" — refusing to clobber it');
  }
  const servers = (existingServers as Record<string, unknown> | undefined) ?? {};
  return {
    ...base,
    mcpServers: {
      ...servers,
      [PEEK_SERVER_KEY]: { ...PEEK_MCP_BLOCK, args: [...PEEK_MCP_BLOCK.args] },
    },
  };
}

/** True if a parsed config already registers a `peek` MCP server. */
export function hasPeekServer(existing: unknown): boolean {
  if (typeof existing !== 'object' || existing === null || Array.isArray(existing)) return false;
  const servers = (existing as Record<string, unknown>).mcpServers;
  if (typeof servers !== 'object' || servers === null || Array.isArray(servers)) return false;
  return PEEK_SERVER_KEY in (servers as Record<string, unknown>);
}

/**
 * Detect line (`//`) or block (slash-star) comments OUTSIDE string literals —
 * i.e. JSONC. VS Code's `.vscode/mcp.json` is JSONC and `JSON.parse` chokes on
 * comments, so the shell uses this to emit an actionable message instead of a
 * cryptic "Unexpected token /". String contents are skipped so a value like
 * `"https://..."` does NOT count as a comment.
 */
export function containsJsonComments(raw: string): boolean {
  let inString = false;
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];
    if (inString) {
      if (ch === '\\') {
        i++; // skip the escaped char
        continue;
      }
      if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === '/' && (raw[i + 1] === '/' || raw[i + 1] === '*')) return true;
  }
  return false;
}

/**
 * The `mcpServers.peek` block as a pretty-printed JSON snippet, for the
 * "add this manually" message path (e.g. JSONC configs we won't rewrite).
 */
export const PEEK_BLOCK_SNIPPET: string = JSON.stringify(
  { mcpServers: { [PEEK_SERVER_KEY]: { ...PEEK_MCP_BLOCK, args: [...PEEK_MCP_BLOCK.args] } } },
  null,
  2,
);

/** Serialize a merged config for writing (2-space indent + trailing newline). */
export function serializeConfig(config: Record<string, unknown>): string {
  return `${JSON.stringify(config, null, 2)}\n`;
}
