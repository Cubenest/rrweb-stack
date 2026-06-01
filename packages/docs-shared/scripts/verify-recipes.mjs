#!/usr/bin/env node
// Verify every recipe in tracelane-docs and peek-docs against the shared
// schema + a battery of integration checks. Run via:
//
//   pnpm --filter @cubenest/docs-shared verify-recipes
//
// Exit code 0 if every recipe passes its required checks (warnings OK).
// Exit code 1 if any recipe has an error-severity issue.

import { execSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';
import { recipeSchema } from '../dist/index.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..', '..', '..');

const SITES = [
  { name: 'tracelane-docs', dir: join(REPO_ROOT, 'apps', 'tracelane-docs') },
  { name: 'peek-docs', dir: join(REPO_ROOT, 'apps', 'peek-docs') },
];

// npm registry probe (cached) ───────────────────────────────────────────
const npmCache = new Map();
function packageExistsOnNpm(pkg) {
  if (npmCache.has(pkg)) return npmCache.get(pkg);
  try {
    execSync(`npm view ${pkg} version`, {
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 10_000,
    });
    npmCache.set(pkg, true);
    return true;
  } catch {
    npmCache.set(pkg, false);
    return false;
  }
}

// frontmatter + body extraction ─────────────────────────────────────────
function parseRecipe(filepath) {
  const raw = readFileSync(filepath, 'utf8');
  const m = raw.match(/^---\n([\s\S]+?)\n---\n([\s\S]*)$/);
  if (!m) throw new Error(`No frontmatter delimiter in ${filepath}`);
  return { frontmatter: yaml.load(m[1]), body: m[2] };
}

// package extraction from code blocks ───────────────────────────────────
const INSTALL_PATTERN =
  /(?:npm\s+(?:i|install|add)|pnpm\s+(?:add|i|install)|yarn\s+add)(?:\s+-[A-Za-z]+)*\s+(@?[\w./-]+)/g;

function extractInstallPackages(body) {
  const pkgs = new Set();
  for (const m of body.matchAll(INSTALL_PATTERN)) {
    pkgs.add(m[1]);
  }
  return [...pkgs];
}

// checks ────────────────────────────────────────────────────────────────
function checkSchema(frontmatter) {
  const parsed = recipeSchema.safeParse(frontmatter);
  if (parsed.success) return null;
  return {
    severity: 'error',
    detail: parsed.error.issues
      .map((i) => `${i.path.join('.') || '<root>'}: ${i.message}`)
      .join('; '),
  };
}

function checkRelatedRecipes(frontmatter, allSlugs) {
  const issues = [];
  for (const slug of frontmatter.relatedRecipes ?? []) {
    if (!allSlugs.has(slug)) {
      issues.push({
        severity: 'error',
        detail: `relatedRecipes entry '${slug}' does not resolve to any recipe in this collection`,
      });
    }
  }
  return issues;
}

function checkArtifact(frontmatter, site) {
  if (!frontmatter.artifact) return null;
  const artifactPath = join(site.dir, `public${frontmatter.artifact}`);
  if (existsSync(artifactPath)) return null;
  return {
    severity: 'error',
    detail: `artifact '${frontmatter.artifact}' not found at ${relative(REPO_ROOT, artifactPath)}`,
  };
}

const INTERNAL_LINK_PATTERN = /\(\/recipes\/([a-z0-9-]+)\)/g;

function checkInternalLinks(body, allSlugs) {
  const issues = [];
  const seen = new Set();
  for (const m of body.matchAll(INTERNAL_LINK_PATTERN)) {
    const slug = m[1];
    if (seen.has(slug)) continue;
    seen.add(slug);
    if (!allSlugs.has(slug)) {
      issues.push({
        severity: 'warning',
        detail: `body links to /recipes/${slug} which doesn't match any recipe in this collection`,
      });
    }
  }
  return issues;
}

const JSON_BLOCK_PATTERN = /```json\n([\s\S]+?)\n```/g;

function checkJsonBlocks(body) {
  const issues = [];
  let idx = 0;
  for (const m of body.matchAll(JSON_BLOCK_PATTERN)) {
    idx += 1;
    try {
      JSON.parse(m[1]);
    } catch (e) {
      issues.push({
        severity: 'error',
        detail: `JSON code block #${idx} fails to parse: ${e.message}`,
      });
    }
  }
  return issues;
}

function checkAspirationalPolicy(body, packages) {
  const aspirationalMarker = /Status:\s*aspirational/i.test(body);
  const unpublished = packages.filter((pkg) => !packageExistsOnNpm(pkg));

  const issues = [];
  if (unpublished.length > 0 && !aspirationalMarker) {
    issues.push({
      severity: 'error',
      detail: `references unpublished package(s) ${unpublished.join(', ')} but missing the "> **Status: aspirational.**" block`,
    });
  } else if (unpublished.length === 0 && aspirationalMarker) {
    issues.push({
      severity: 'warning',
      detail:
        'has "Status: aspirational" block but every referenced package is published — consider flipping to ready',
    });
  }
  return { issues, unpublished, aspirational: aspirationalMarker };
}

function checkMcpWiring(body, siteName) {
  if (siteName !== 'peek-docs') return [];
  const issues = [];
  for (const m of body.matchAll(JSON_BLOCK_PATTERN)) {
    const raw = m[1];
    if (!/peek/i.test(raw)) continue;
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      continue; // jsonBlocks check will catch parse errors
    }
    const peekEntry = parsed?.peek ?? parsed?.mcpServers?.peek;
    if (!peekEntry) continue;
    const okCommand = peekEntry.command === 'npx';
    const okArgs =
      Array.isArray(peekEntry.args) &&
      peekEntry.args[0] === '-y' &&
      peekEntry.args[1] === '@peekdev/mcp';
    if (!okCommand || !okArgs) {
      issues.push({
        severity: 'error',
        detail: `non-canonical peek MCP entry: ${JSON.stringify(peekEntry)} (expected { command: "npx", args: ["-y", "@peekdev/mcp"] })`,
      });
    }
  }
  return issues;
}

// per-recipe verification ───────────────────────────────────────────────
function verifyRecipe(filepath, site, allSlugs) {
  const slug = basename(filepath, '.md');
  let frontmatter;
  let body;
  try {
    ({ frontmatter, body } = parseRecipe(filepath));
  } catch (e) {
    return {
      file: relative(REPO_ROOT, filepath),
      slug,
      issues: [{ category: 'parse', severity: 'error', detail: e.message }],
      pass: false,
    };
  }

  const issues = [];

  const schemaIssue = checkSchema(frontmatter);
  if (schemaIssue) issues.push({ category: 'schema', ...schemaIssue });

  for (const i of checkRelatedRecipes(frontmatter, allSlugs))
    issues.push({ category: 'relatedRecipes', ...i });

  const artifactIssue = checkArtifact(frontmatter, site);
  if (artifactIssue) issues.push({ category: 'artifact', ...artifactIssue });

  for (const i of checkInternalLinks(body, allSlugs))
    issues.push({ category: 'internalLink', ...i });

  for (const i of checkJsonBlocks(body)) issues.push({ category: 'jsonSnippet', ...i });

  const packages = extractInstallPackages(body);
  const aspirationalReport = checkAspirationalPolicy(body, packages);
  for (const i of aspirationalReport.issues) issues.push({ category: 'aspirationalPolicy', ...i });

  for (const i of checkMcpWiring(body, site.name)) issues.push({ category: 'mcpWiring', ...i });

  const errorCount = issues.filter((i) => i.severity === 'error').length;

  return {
    file: relative(REPO_ROOT, filepath),
    slug,
    title: frontmatter.title,
    type: frontmatter.type,
    status: frontmatter.status,
    integrations: frontmatter.integrations ?? [],
    packages,
    unpublishedPackages: aspirationalReport.unpublished,
    aspirational: aspirationalReport.aspirational,
    issues,
    pass: errorCount === 0,
  };
}

// report rendering ──────────────────────────────────────────────────────
function renderSiteReport(site, results) {
  const passed = results.filter((r) => r.pass).length;
  const failed = results.length - passed;
  const aspirational = results.filter((r) => r.aspirational).length;
  const heroes = results.filter((r) => r.type === 'hero').length;
  const shorts = results.filter((r) => r.type === 'short').length;

  let md = `## ${site.name} — ${results.length} recipes (${heroes} hero / ${shorts} short)\n\n`;
  md += `**Status:** ${passed}/${results.length} pass, ${failed} fail, ${aspirational} flagged aspirational.\n\n`;

  md += '### Summary table\n\n';
  md += '| Slug | Type | Status | Aspirational | Issues |\n';
  md += '|---|---|---|---|---|\n';
  for (const r of results) {
    const issueSummary =
      r.issues.length === 0
        ? '✓'
        : r.issues
            .map((i) => `${i.severity === 'error' ? '✗' : '⚠'} ${i.category}: ${i.detail}`)
            .join('<br>');
    md += `| \`${r.slug}\` | ${r.type ?? '?'} | ${r.status ?? '?'} | ${r.aspirational ? 'yes' : 'no'} | ${issueSummary} |\n`;
  }
  md += '\n';

  md += '### Per-recipe detail\n\n';
  for (const r of results) {
    md += `#### \`${r.slug}\`\n\n`;
    md += `- **Title:** ${r.title ?? '?'}\n`;
    md += `- **Type / status:** ${r.type ?? '?'} / ${r.status ?? '?'}\n`;
    md += `- **Integrations:** ${r.integrations.length > 0 ? r.integrations.map((t) => `\`${t}\``).join(', ') : '(none)'}\n`;
    md += `- **Packages referenced:** ${r.packages.length > 0 ? r.packages.map((p) => `\`${p}\``).join(', ') : '(none)'}\n`;
    if (r.unpublishedPackages.length > 0) {
      md += `- **Unpublished (aspirational deps):** ${r.unpublishedPackages.map((p) => `\`${p}\``).join(', ')}\n`;
    }
    md += `- **Aspirational flag in body:** ${r.aspirational ? 'yes' : 'no'}\n`;
    if (r.issues.length > 0) {
      md += '- **Issues:**\n';
      for (const i of r.issues) {
        md += `  - ${i.severity === 'error' ? '✗' : '⚠'} **${i.category}:** ${i.detail}\n`;
      }
    } else {
      md += '- **Issues:** none — passes all auto-checks ✓\n';
    }
    md += '\n';
  }

  return { md, passed, failed, aspirational };
}

function renderConsoleSummary(site, results) {
  const passed = results.filter((r) => r.pass).length;
  console.log(`\n${site.name}: ${passed}/${results.length} pass`);
  for (const r of results) {
    const mark = r.pass ? '✓' : '✗';
    const tags = [r.aspirational ? 'aspirational' : null].filter(Boolean);
    const tagStr = tags.length ? ` [${tags.join(', ')}]` : '';
    console.log(`  ${mark} ${r.slug}${tagStr}`);
    if (!r.pass) {
      for (const i of r.issues.filter((x) => x.severity === 'error')) {
        console.log(`      ✗ ${i.category}: ${i.detail}`);
      }
    }
    for (const i of r.issues.filter((x) => x.severity === 'warning')) {
      console.log(`      ⚠ ${i.category}: ${i.detail}`);
    }
  }
}

// main ──────────────────────────────────────────────────────────────────
function main() {
  let mdReport = `# Recipe verification report\n\n_Generated by \`pnpm --filter @cubenest/docs-shared verify-recipes\` on ${new Date().toISOString()}_\n\n`;
  const jsonReport = { generatedAt: new Date().toISOString(), sites: {} };
  let anyFailure = false;

  for (const site of SITES) {
    const recipesDir = join(site.dir, 'src', 'content', 'recipes');
    if (!existsSync(recipesDir)) {
      console.log(`Skipping ${site.name}: no recipes dir`);
      continue;
    }
    const files = readdirSync(recipesDir)
      .filter((f) => f.endsWith('.md'))
      .sort();
    const allSlugs = new Set(files.map((f) => f.replace(/\.md$/, '')));

    console.log(`\n=== Verifying ${site.name} (${files.length} recipes) ===`);

    const results = files.map((f) => verifyRecipe(join(recipesDir, f), site, allSlugs));

    renderConsoleSummary(site, results);

    const { md, failed } = renderSiteReport(site, results);
    mdReport += md;
    jsonReport.sites[site.name] = results;
    if (failed > 0) anyFailure = true;
  }

  const reportDir = join(REPO_ROOT, '_context', 'docs', 'research');
  const jsonOut = join(reportDir, '2026-06-01-recipe-verification-report.json');
  const mdOut = join(reportDir, '2026-06-01-recipe-verification-report.md');

  if (existsSync(reportDir)) {
    writeFileSync(jsonOut, JSON.stringify(jsonReport, null, 2));
    writeFileSync(mdOut, mdReport);
    console.log('\nReports:');
    console.log(`  JSON: ${relative(REPO_ROOT, jsonOut)}`);
    console.log(`  MD:   ${relative(REPO_ROOT, mdOut)}`);
  } else {
    console.log('\n(_context/docs/research/ not present; skipping report file write)');
  }

  console.log(`\nDone. ${anyFailure ? 'EXIT 1 (failures)' : 'EXIT 0 (clean)'}`);
  process.exit(anyFailure ? 1 : 0);
}

main();
