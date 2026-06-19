import type { APIRoute } from 'astro';
import { getCollection } from 'astro:content';

// /llms.txt — the AI-agent index for this site (llmstxt.org format). Generated at
// build time from the recipes content collection so it never drifts and never
// leaks drafts (same published filter as the recipe routes). Honest scope: this
// is a discovery/pointer file for the IDE-agent markdown-fetch channel (links
// point at the .md variants), not a ranking or citation signal.
export const GET: APIRoute = async ({ site }) => {
  const base = (site?.href ?? 'https://peek.cubenest.in/').replace(/\/$/, '');
  const recipes = (
    await getCollection(
      'recipes',
      ({ data }) => data.status !== 'draft' || import.meta.env.DEV,
    )
  ).sort((a, b) => Number(b.data.publishedAt) - Number(a.data.publishedAt));

  const recipeLines = recipes
    .map(
      (r) =>
        `- [${r.data.title}](${base}/recipes/${r.id.replace(/\.md$/, '')}.md): ${r.data.description}`,
    )
    .join('\n');

  const body = `# peek

> Open-source, local-first browser companion for AI coding agents. Records a masked, authenticated browser session to a local SQLite store and exposes it to coding agents over MCP — console errors, failed network calls, the DOM at any timestamp, and a generated Playwright repro. No cloud, no telemetry. Apache-2.0, pre-1.0 alpha.

peek ships as a Chrome MV3 extension, a stdio MCP server (\`@peekdev/mcp\`), and a CLI (\`@peekdev/cli\`). Run \`npx @peekdev/cli init\` to wire the MCP server into Claude Code, Cursor, Cline, or Windsurf, then load the extension and record a session your agent can read.

## Docs
- [Getting started](${base}/getting-started): install the CLI + extension and register the MCP server
- [Privacy and redaction](${base}/privacy): local-only storage, masking, and the five-level permission model

## Recipes
${recipeLines}

## Optional
- [peek vs Browser MCP tools](${base}/vs-browser-mcp): how peek differs from browsermcp, playwright-mcp, and browser-use
- [peek vs Jam.dev](${base}/vs-jam-dev): peek's consumer is your AI agent; Jam's is a human reviewer
`;

  return new Response(body, {
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });
};
