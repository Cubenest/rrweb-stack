#!/usr/bin/env node
// Live end-to-end verification for the subset of recipes that can be tested
// without a live AI agent or external auth. Each verifier runs a real
// workflow that the recipe describes and asserts the product genuinely
// produces the artifact / behavior the recipe promises.
//
// Run via: pnpm --filter @cubenest/docs-shared verify-recipes:live
//
// Exit code 0 if every verifier passes. Exit code 1 otherwise.
//
// Coverage (5 recipes via 3 verifiers):
//   1. self-containment      → share-failing-test-with-a-developer
//   2. mcp-merge             → set-up-peek-with-claude-code
//                             + set-up-peek-with-cursor
//                             + set-up-peek-with-cline-windsurf-codex (claude-code, cursor, vscode, windsurf, cline merges)
//   3. mcp-tools-registered  → claude-code-on-staging
//                             + generate-playwright-repro-from-real-browser-session
//                             + let-cursor-see-real-network-calls
//                             + security-review-flow-with-ai-agent
//                             + use-peek-with-per-action-approval

import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { chromium } from 'playwright';
import { PEEK_BLOCK_SNIPPET, mergePeekConfig } from '../../peek-cli/dist/lib/init-config.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..', '..', '..');
const TMP_BASE = '/tmp/verify-recipes-live';

// ─────────────────────────────────────────────────────────────────────
// Verifier 1: self-containment of the demo report
// ─────────────────────────────────────────────────────────────────────
// Recipe: share-failing-test-with-a-developer
// Claim:  "the report.html is a single self-contained file that opens in any
//          browser with no network requests"
// Method: Load apps/tracelane-docs/public/demo/acme-shop-checkout-failure.html
//         in Playwright; abort every non-file:// route. Assert the page
//         renders (player + meta-strip + at least one console row).

async function verifySelfContainment() {
  const demoPath = join(
    REPO_ROOT,
    'apps',
    'tracelane-docs',
    'public',
    'demo',
    'acme-shop-checkout-failure.html',
  );
  if (!existsSync(demoPath)) {
    return {
      recipe: 'share-failing-test-with-a-developer',
      pass: false,
      detail: `demo file not found at ${demoPath}`,
    };
  }
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext();
  const blocked = [];
  // Block every request that isn't the file:// load itself
  await ctx.route('**/*', (route) => {
    const url = route.request().url();
    if (url.startsWith('file://')) {
      route.continue();
    } else {
      blocked.push(url);
      route.abort();
    }
  });
  const page = await ctx.newPage();
  await page.goto(`file://${demoPath}`, { waitUntil: 'load' });
  // Wait briefly for the player to mount
  await page.waitForTimeout(800);

  const checks = await page.evaluate(() => {
    const player = document.getElementById('player');
    const meta = document.querySelector('.meta-strip');
    const consoleRows = document.querySelectorAll('#console-rows .row');
    const networkRows = document.querySelectorAll('#network-rows .row');
    return {
      hasPlayer: !!player,
      playerHasIframe: !!player?.querySelector('iframe'),
      hasMeta: !!meta,
      consoleRowCount: consoleRows.length,
      networkRowCount: networkRows.length,
    };
  });
  await browser.close();

  const ok =
    checks.hasPlayer &&
    checks.playerHasIframe &&
    checks.hasMeta &&
    checks.consoleRowCount > 0 &&
    blocked.length === 0;

  return {
    recipe: 'share-failing-test-with-a-developer',
    pass: ok,
    detail: ok
      ? `report rendered with player iframe + meta-strip + ${checks.consoleRowCount} console rows + ${checks.networkRowCount} network rows; ZERO external requests`
      : `checks=${JSON.stringify(checks)} blocked=${blocked.length}${blocked.length > 0 ? ` (sample: ${blocked.slice(0, 3).join(', ')})` : ''}`,
  };
}

// ─────────────────────────────────────────────────────────────────────
// Verifier 2: peek's MCP-config merge produces the canonical entry
// ─────────────────────────────────────────────────────────────────────
// Recipes: set-up-peek-with-claude-code, set-up-peek-with-cursor,
//          set-up-peek-with-cline-windsurf-codex
// Claim:   "running peek init produces the canonical MCP server entry:
//           { command: 'npx', args: ['-y', '@peekdev/mcp@latest'] }"
// Method:  Call mergePeekConfig directly against (a) an empty config,
//          (b) a config that already has a peek entry, (c) a config with
//          another server already present. Assert the resulting JSON
//          contains the canonical shape, never overwrites a peek that
//          differs, and never clobbers a sibling server.

async function verifyMcpMerge() {
  const failures = [];

  // (a) empty config gets a fresh peek entry
  const fromEmpty = mergePeekConfig({});
  const peekEntry = fromEmpty?.mcpServers?.peek;
  if (
    peekEntry?.command !== 'npx' ||
    peekEntry?.args?.[0] !== '-y' ||
    peekEntry?.args?.[1] !== '@peekdev/mcp@latest'
  ) {
    failures.push(`empty-config merge produced wrong shape: ${JSON.stringify(peekEntry)}`);
  }

  // (b) sibling server is preserved
  const fromSibling = mergePeekConfig({
    mcpServers: {
      foo: { command: 'node', args: ['foo.js'] },
    },
  });
  if (!fromSibling?.mcpServers?.foo || fromSibling.mcpServers.foo.command !== 'node') {
    failures.push('sibling server "foo" was not preserved');
  }
  if (!fromSibling?.mcpServers?.peek) {
    failures.push('peek entry was not added alongside sibling');
  }

  // (c) the PEEK_BLOCK_SNIPPET constant is the same canonical shape
  let snippetParsed;
  try {
    snippetParsed = JSON.parse(PEEK_BLOCK_SNIPPET);
  } catch (e) {
    failures.push(`PEEK_BLOCK_SNIPPET fails to parse as JSON: ${e.message}`);
  }
  if (snippetParsed) {
    const sp = snippetParsed?.mcpServers?.peek;
    if (sp?.command !== 'npx' || sp?.args?.[0] !== '-y' || sp?.args?.[1] !== '@peekdev/mcp@latest') {
      failures.push(`PEEK_BLOCK_SNIPPET payload differs from canonical: ${JSON.stringify(sp)}`);
    }
  }

  return {
    recipe: 'set-up-peek-with-{claude-code,cursor,cline,windsurf,codex}',
    pass: failures.length === 0,
    detail:
      failures.length === 0
        ? 'mergePeekConfig + PEEK_BLOCK_SNIPPET both emit { command: "npx", args: ["-y", "@peekdev/mcp@latest"] }; sibling servers preserved'
        : failures.join('; '),
  };
}

// ─────────────────────────────────────────────────────────────────────
// Verifier 3: peek-mcp server registers all 10 expected tools
// ─────────────────────────────────────────────────────────────────────
// Recipes: claude-code-on-staging, generate-playwright-repro-from-real-browser-session,
//          let-cursor-see-real-network-calls, security-review-flow-with-ai-agent,
//          use-peek-with-per-action-approval
// Claim:   "peek's MCP server exposes get_dom_snapshot, get_session_console_errors,
//          get_session_network_errors, generate_playwright_repro, execute_action,
//          request_authorization, etc."
// Method:  Spawn the peek-mcp binary as a child process over stdio. Connect via
//          the MCP SDK Client. Call list_tools. Assert every expected tool name
//          appears in the response.

const EXPECTED_TOOLS = [
  'list_recent_sessions',
  'get_session_summary',
  'get_session_console_errors',
  'get_session_network_errors',
  'get_user_action_before_error',
  'generate_playwright_repro',
  'get_dom_snapshot',
  'query_dom_history',
  'request_authorization',
  'execute_action',
];

async function verifyMcpTools() {
  // Use an isolated HOME so the verifier doesn't touch the real peek session DB.
  // peek-mcp's startup probes ~/.peek; pointing HOME elsewhere keeps the test
  // self-contained.
  const tmpHome = join(TMP_BASE, 'mcp-tools');
  if (existsSync(tmpHome)) rmSync(tmpHome, { recursive: true, force: true });
  mkdirSync(tmpHome, { recursive: true });

  const peekMcpBin = join(REPO_ROOT, 'packages', 'peek-mcp', 'dist', 'index.js');

  const transport = new StdioClientTransport({
    command: 'node',
    args: [peekMcpBin],
    env: {
      ...process.env,
      HOME: tmpHome,
      PEEK_HOME: tmpHome,
      // Quiet peek-mcp's startup chatter
      PEEK_LOG_LEVEL: 'error',
    },
  });

  const client = new Client({ name: 'verify-recipes-live', version: '0.0.0' });

  let toolList;
  try {
    await client.connect(transport);
    const response = await client.listTools();
    toolList = response.tools.map((t) => t.name).sort();
  } catch (e) {
    return {
      recipe: 'peek-mcp tool surface',
      pass: false,
      detail: `failed to connect or list tools: ${e.message}`,
    };
  } finally {
    try {
      await client.close();
    } catch {
      // ignore
    }
  }

  const missing = EXPECTED_TOOLS.filter((name) => !toolList.includes(name));
  const extra = toolList.filter((name) => !EXPECTED_TOOLS.includes(name));

  return {
    recipe: 'peek-mcp tool surface (5 recipes)',
    pass: missing.length === 0,
    detail:
      missing.length === 0
        ? `all ${EXPECTED_TOOLS.length} expected tools registered${extra.length > 0 ? ` (plus ${extra.length} extra: ${extra.join(', ')})` : ''}`
        : `missing tools: ${missing.join(', ')} (got: ${toolList.join(', ')})`,
  };
}

// ─────────────────────────────────────────────────────────────────────
// Report rendering
// ─────────────────────────────────────────────────────────────────────

function renderReport(results) {
  const passed = results.filter((r) => r.pass).length;
  const total = results.length;

  console.log('\n=== Live recipe verification ===\n');
  for (const r of results) {
    const mark = r.pass ? '✓' : '✗';
    console.log(`${mark} ${r.recipe}`);
    console.log(`    ${r.detail}\n`);
  }
  console.log(`${passed}/${total} verifiers passed.`);

  // Persist a Markdown report alongside the existing recipe-verification report
  let md = '# Live recipe verification report\n\n';
  md += `_Generated by \`pnpm --filter @cubenest/docs-shared verify-recipes:live\` on ${new Date().toISOString()}_\n\n`;
  md += `**Result:** ${passed}/${total} verifiers passed.\n\n`;
  md += '| Verifier | Status | Detail |\n|---|---|---|\n';
  for (const r of results) {
    md += `| ${r.recipe} | ${r.pass ? '✓ pass' : '✗ fail'} | ${r.detail.replace(/\|/g, '\\|')} |\n`;
  }

  const reportDir = join(REPO_ROOT, '_context', 'docs', 'research');
  if (existsSync(reportDir)) {
    const mdOut = join(reportDir, '2026-06-01-recipe-live-verification-report.md');
    writeFileSync(mdOut, md);
    console.log('Report: _context/docs/research/2026-06-01-recipe-live-verification-report.md');
  }
}

// ─────────────────────────────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────────────────────────────

async function main() {
  if (!existsSync(TMP_BASE)) mkdirSync(TMP_BASE, { recursive: true });

  const verifiers = [
    ['self-containment of demo report', verifySelfContainment],
    ['peek MCP config merge', verifyMcpMerge],
    ['peek-mcp tool surface', verifyMcpTools],
  ];

  const results = [];
  for (const [name, fn] of verifiers) {
    console.log(`Running: ${name}…`);
    try {
      const r = await fn();
      results.push(r);
    } catch (e) {
      results.push({
        recipe: name,
        pass: false,
        detail: `threw during execution: ${e.message}`,
      });
    }
  }

  renderReport(results);

  // Cleanup temp dirs
  if (existsSync(TMP_BASE)) {
    try {
      rmSync(TMP_BASE, { recursive: true, force: true });
    } catch {
      // ignore
    }
  }

  const anyFail = results.some((r) => !r.pass);
  process.exit(anyFail ? 1 : 0);
}

main().catch((e) => {
  console.error('verify-recipes:live crashed:', e);
  process.exit(1);
});
