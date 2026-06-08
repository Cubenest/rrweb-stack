#!/usr/bin/env node
// Verify every recipe in tracelane-docs and peek-docs against the shared
// schema + a battery of integration checks. Run via:
//
//   pnpm --filter @cubenest/docs-shared verify-recipes
//   node packages/docs-shared/scripts/verify-recipes.mjs
//
// Exit code 0 if every recipe passes its required checks (warnings OK).
// Exit code 1 if any recipe has an error-severity issue.
//
// 404 GUARD (HARD error): production builds drop `status: draft` recipes
// (router filter `data.status !== 'draft'` in apps/*/src/pages/recipes/
// [...slug].astro). A PUBLISHED recipe that links to a draft/archived
// recipe — via a `relatedRecipes` frontmatter entry OR an inline body
// `](/recipes/<slug>)` link — therefore 404s in prod. Both are treated as
// error-severity here so CI blocks the regression.
//
// HERO-IMAGE CHECK (env-gated severity): each recipe body references its
// hero screenshot as `](/recipes/assets/<file>)`; the file must exist under
// apps/<site>/public/recipes/assets/. The real screenshots are supplied by
// the maintainer separately, so a MISSING image is a loud NON-FATAL warning
// by DEFAULT (CI stays green). Set STRICT_RECIPE_ASSETS=1 in the env to
// promote missing images to a HARD error (non-zero exit) — flip this on in
// CI once the screenshots have landed.

const STRICT_RECIPE_ASSETS = process.env.STRICT_RECIPE_ASSETS === '1';

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

// Status-aware link guard ────────────────────────────────────────────────
// Only meaningful for PUBLISHED source recipes: a published page that links
// to a draft/archived target 404s in prod. Covers both the relatedRecipes
// frontmatter and inline body /recipes/<slug> links.
const NON_PUBLIC_STATUSES = new Set(['draft', 'archived']);

function checkStatusAwareLinks(frontmatter, body, statusBySlug) {
  const issues = [];
  if (frontmatter.status !== 'published') return issues;

  for (const slug of frontmatter.relatedRecipes ?? []) {
    const targetStatus = statusBySlug.get(slug);
    if (targetStatus && NON_PUBLIC_STATUSES.has(targetStatus)) {
      issues.push({
        severity: 'error',
        detail: `published recipe links (relatedRecipes) to '${slug}' which is status: ${targetStatus} — excluded from prod, would 404`,
      });
    }
  }

  const seen = new Set();
  for (const m of body.matchAll(INTERNAL_LINK_PATTERN)) {
    const slug = m[1];
    if (seen.has(slug)) continue;
    seen.add(slug);
    const targetStatus = statusBySlug.get(slug);
    if (targetStatus && NON_PUBLIC_STATUSES.has(targetStatus)) {
      issues.push({
        severity: 'error',
        detail: `published recipe body links to /recipes/${slug} which is status: ${targetStatus} — excluded from prod, would 404`,
      });
    }
  }
  return issues;
}

// Hero-image existence check ───────────────────────────────────────────────
// Body images are referenced as ](/recipes/assets/<file>); the file must be
// served from apps/<site>/public/recipes/assets/<file>. Missing images are a
// loud warning by default (real screenshots pending) and a hard error when
// STRICT_RECIPE_ASSETS=1.
const BODY_IMAGE_PATTERN = /\]\((\/recipes\/assets\/[^)]+)\)/g;

function checkBodyImages(frontmatter, body, site) {
  if (frontmatter.status !== 'published') return [];
  const issues = [];
  const seen = new Set();
  for (const m of body.matchAll(BODY_IMAGE_PATTERN)) {
    const ref = m[1]; // e.g. /recipes/assets/foo.png
    if (seen.has(ref)) continue;
    seen.add(ref);
    const filePath = join(site.dir, 'public', ref);
    if (!existsSync(filePath)) {
      issues.push({
        severity: STRICT_RECIPE_ASSETS ? 'error' : 'warning',
        missingHeroImage: true,
        ref,
        path: relative(REPO_ROOT, filePath),
        detail: `hero image '${ref}' not found at ${relative(REPO_ROOT, filePath)}`,
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
      peekEntry.args[1] === '@peekdev/mcp@latest';
    if (!okCommand || !okArgs) {
      issues.push({
        severity: 'error',
        detail: `non-canonical peek MCP entry: ${JSON.stringify(peekEntry)} (expected { command: "npx", args: ["-y", "@peekdev/mcp@latest"] })`,
      });
    }
  }
  return issues;
}

// per-recipe verification ───────────────────────────────────────────────
function verifyRecipe(filepath, site, allSlugs, statusBySlug) {
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

  for (const i of checkStatusAwareLinks(frontmatter, body, statusBySlug))
    issues.push({ category: 'draftLink', ...i });

  for (const i of checkBodyImages(frontmatter, body, site))
    issues.push({ category: 'heroImage', ...i });

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
  const missingHeroImages = [];

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

    // Build a slug -> status map up front so the status-aware link guard can
    // resolve a link target's publication state regardless of file order.
    const statusBySlug = new Map();
    for (const f of files) {
      const slug = f.replace(/\.md$/, '');
      try {
        const { frontmatter } = parseRecipe(join(recipesDir, f));
        statusBySlug.set(slug, frontmatter.status);
      } catch {
        statusBySlug.set(slug, undefined);
      }
    }

    console.log(`\n=== Verifying ${site.name} (${files.length} recipes) ===`);

    const results = files.map((f) =>
      verifyRecipe(join(recipesDir, f), site, allSlugs, statusBySlug),
    );

    renderConsoleSummary(site, results);

    const { md, failed } = renderSiteReport(site, results);
    mdReport += md;
    jsonReport.sites[site.name] = results;
    if (failed > 0) anyFailure = true;

    for (const r of results) {
      for (const i of r.issues) {
        if (i.missingHeroImage) {
          missingHeroImages.push({ site: site.name, slug: r.slug, path: i.path });
        }
      }
    }
  }

  // Loud hero-image summary — warning by default, hard error under STRICT.
  if (missingHeroImages.length > 0) {
    const banner = STRICT_RECIPE_ASSETS ? '✗ STRICT' : '⚠';
    console.log(
      `\n${'─'.repeat(72)}\n${banner} MISSING HERO IMAGES: ${missingHeroImages.length} published recipe(s) reference a screenshot that is not yet present.`,
    );
    for (const m of missingHeroImages) {
      console.log(`  ${banner} MISSING HERO IMAGE: ${m.site}/${m.slug} -> ${m.path}`);
    }
    if (STRICT_RECIPE_ASSETS) {
      console.log(
        '  STRICT_RECIPE_ASSETS=1 → missing hero images are HARD errors (build blocked).',
      );
      anyFailure = true;
    } else {
      console.log(
        '  These are NON-FATAL (CI stays green). Drop the screenshots into the assets dirs,',
      );
      console.log('  then set STRICT_RECIPE_ASSETS=1 in CI to enforce their presence.');
    }
    console.log('─'.repeat(72));
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
