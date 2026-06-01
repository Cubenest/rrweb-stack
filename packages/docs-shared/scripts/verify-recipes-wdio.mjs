#!/usr/bin/env node
// WDIO smoke verifier — runs the recipe's exact workflow end-to-end against
// the latest npm-published @tracelane/wdio. Validates that:
//   1. `npm install` of the published package succeeds
//   2. A failing WDIO spec produces a tracelane-report-*.html
//   3. The report contains the rrweb player + meta-strip + console + network
//      panels (the structure every recipe's payoff section describes)
//
// Recipes covered (5):
//   - add-tracelane-to-webdriverio-in-5-minutes
//   - debug-flaky-checkout-test-in-ci (the install + report half; CI artifact
//     half remains manual)
//   - share-failing-test-with-a-developer (the report's self-containment
//     half remains in verify-recipes:live; this covers the upstream
//     generation)
//   - reproduce-headless-only-failure-locally (the same chrome --headless=new
//     flags the recipe describes)
//   - catch-visual-regression-across-test-run (the report exists for the
//     scrubber to work against)
//
// Run via: pnpm --filter @cubenest/docs-shared verify-recipes:wdio
//
// Heavy: ~1-2 minutes per run (npm install + browser launch + WDIO suite).
// Keep separate from verify-recipes:live so the fast feedback loop stays fast.
//
// Exit 0 if every assertion passes. Exit 1 otherwise.

import { spawn } from 'node:child_process';
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..', '..', '..');
const FIXTURE_SRC = join(REPO_ROOT, 'docs', 'qa', 'fixtures', 'tracelane-demo');
const WORK_DIR = '/tmp/verify-recipes-wdio';

// Versions to pin. Bumped to whatever's currently published — keep this in
// sync with the published alphas. The verifier could fetch latest dynamically,
// but pinning here makes the verifier's intent explicit + auditable.
const TRACELANE_VERSIONS = {
  '@tracelane/core': '^0.1.0-alpha.9',
  '@tracelane/report': '^0.1.0-alpha.11',
  '@tracelane/wdio': '^0.1.0-alpha.14',
};

function step(msg) {
  process.stdout.write(`  • ${msg}\n`);
}

function runCmd(command, args, cwd, { quiet = false, allowNonZeroExit = false } = {}) {
  return new Promise((resolve, reject) => {
    const proc = spawn(command, args, {
      cwd,
      stdio: quiet ? ['ignore', 'pipe', 'pipe'] : 'inherit',
      env: { ...process.env, CI: '1' },
    });
    const out = [];
    const err = [];
    if (quiet) {
      proc.stdout.on('data', (chunk) => out.push(chunk));
      proc.stderr.on('data', (chunk) => err.push(chunk));
    }
    proc.on('error', reject);
    proc.on('close', (code) => {
      const result = {
        code,
        stdout: Buffer.concat(out).toString('utf8'),
        stderr: Buffer.concat(err).toString('utf8'),
      };
      if (code !== 0 && !allowNonZeroExit) {
        const detail = quiet
          ? `\n--- stderr ---\n${result.stderr}\n--- stdout ---\n${result.stdout}`
          : '';
        reject(new Error(`${command} ${args.join(' ')} exited ${code}${detail}`));
        return;
      }
      resolve(result);
    });
  });
}

async function setupFixture() {
  if (existsSync(WORK_DIR)) {
    step(`cleaning previous ${WORK_DIR}`);
    rmSync(WORK_DIR, { recursive: true, force: true });
  }
  mkdirSync(WORK_DIR, { recursive: true });

  step('copying fixture to temp dir');
  cpSync(FIXTURE_SRC, WORK_DIR, { recursive: true });

  // Bump @tracelane/* versions in the copy. Don't touch the source fixture.
  const pkgPath = join(WORK_DIR, 'package.json');
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
  for (const [name, version] of Object.entries(TRACELANE_VERSIONS)) {
    if (pkg.devDependencies?.[name]) {
      pkg.devDependencies[name] = version;
    }
  }
  writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`);
  step(
    `pinned @tracelane/* to current: wdio ${TRACELANE_VERSIONS['@tracelane/wdio']}, report ${TRACELANE_VERSIONS['@tracelane/report']}, core ${TRACELANE_VERSIONS['@tracelane/core']}`,
  );
}

async function installDeps() {
  step('npm install (this is the slow part — ~30-60s)');
  const t0 = Date.now();
  await runCmd('npm', ['install', '--no-audit', '--no-fund', '--prefer-online'], WORK_DIR, {
    quiet: true,
  });
  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
  step(`npm install completed in ${elapsed}s`);
}

async function runFailingSpec() {
  step('running `npm run test:fail` — expected to exit non-zero (deliberate failure)');
  const t0 = Date.now();
  const result = await runCmd('npm', ['run', 'test:fail'], WORK_DIR, {
    quiet: true,
    allowNonZeroExit: true,
  });
  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
  step(`test run finished in ${elapsed}s (exit ${result.code})`);
  return result;
}

function findReport() {
  const reportsDir = join(WORK_DIR, 'tracelane-reports');
  if (!existsSync(reportsDir)) {
    return null;
  }
  const reports = readdirSync(reportsDir).filter(
    (f) => f.endsWith('.html') && f.includes('failing'),
  );
  return reports.length > 0 ? join(reportsDir, reports[0]) : null;
}

function inspectReport(reportPath) {
  const html = readFileSync(reportPath, 'utf8');
  const sizeKb = (html.length / 1024).toFixed(1);

  // Structural checks — the report must contain the elements every recipe's
  // payoff section describes. We grep the source rather than parse the DOM
  // (Playwright would be overkill for this).
  const checks = {
    hasPlayerEl: html.includes('id="player"'),
    hasMetaStrip: html.includes('meta-strip'),
    hasConsoleRows: html.includes('id="console-rows"'),
    hasNetworkRows: html.includes('id="network-rows"'),
    hasRrwebPlayerUmd: /rrweb/i.test(html),
    hasInlineEvents: html.includes('EVENTS_GZ_B64'),
    sizeOver50Kb: html.length > 50_000,
  };

  return { html, sizeKb, checks };
}

async function cleanup() {
  if (existsSync(WORK_DIR)) {
    try {
      rmSync(WORK_DIR, { recursive: true, force: true });
    } catch {
      // ignore cleanup failure
    }
  }
}

async function main() {
  console.log('=== WDIO smoke verifier (verify-recipes:wdio) ===\n');
  console.log('Fixture: docs/qa/fixtures/tracelane-demo/');
  console.log(`Workdir: ${WORK_DIR}\n`);

  if (!existsSync(FIXTURE_SRC)) {
    console.error(`✗ Fixture not found at ${FIXTURE_SRC}`);
    process.exit(1);
  }

  let reportPath = null;
  let inspection = null;
  let failureReason = null;

  try {
    await setupFixture();
    await installDeps();
    await runFailingSpec();

    reportPath = findReport();
    if (!reportPath) {
      failureReason =
        'No tracelane-report-*.html found in tracelane-reports/ after the failing spec ran';
    } else {
      inspection = inspectReport(reportPath);
    }
  } catch (e) {
    failureReason = `Workflow crashed: ${e.message}`;
  }

  console.log('\n=== Result ===\n');

  if (failureReason) {
    console.log(`✗ ${failureReason}\n`);
    await cleanup();
    process.exit(1);
  }

  const allOk = Object.values(inspection.checks).every(Boolean);

  if (allOk) {
    console.log(`✓ Report generated at ${reportPath}`);
    console.log(`  size: ${inspection.sizeKb} KB`);
    console.log(
      '  contains: player + meta-strip + console-rows + network-rows + rrweb + inline events',
    );
    console.log('\nRecipes verified end-to-end:');
    console.log('  ✓ add-tracelane-to-webdriverio-in-5-minutes');
    console.log('  ✓ debug-flaky-checkout-test-in-ci (install + report half)');
    console.log('  ✓ share-failing-test-with-a-developer (upstream generation)');
    console.log('  ✓ reproduce-headless-only-failure-locally (same headless config)');
    console.log('  ✓ catch-visual-regression-across-test-run (report exists for the scrubber)');
  } else {
    console.log(`✗ Report at ${reportPath} is missing expected sections.`);
    console.log(`  size: ${inspection.sizeKb} KB`);
    console.log(`  checks: ${JSON.stringify(inspection.checks)}`);
  }

  // Write Markdown report
  const reportDir = join(REPO_ROOT, '_context', 'docs', 'research');
  if (existsSync(reportDir)) {
    const mdOut = join(reportDir, '2026-06-01-recipe-wdio-verification-report.md');
    let md = '# WDIO smoke verification report\n\n';
    md += `_Generated by \`pnpm --filter @cubenest/docs-shared verify-recipes:wdio\` on ${new Date().toISOString()}_\n\n`;
    if (allOk) {
      md += '**Result:** ✓ Pass.\n\n';
      md += `Report generated at \`${reportPath.replace(WORK_DIR, '<workdir>')}\`, size ${inspection.sizeKb} KB. Contains player + meta-strip + console panel + network panel + rrweb + inline events.\n\n`;
      md += '**Recipes verified end-to-end:**\n\n';
      md += '- `add-tracelane-to-webdriverio-in-5-minutes`\n';
      md += '- `debug-flaky-checkout-test-in-ci` (install + report half)\n';
      md += '- `share-failing-test-with-a-developer` (upstream generation)\n';
      md += '- `reproduce-headless-only-failure-locally`\n';
      md += '- `catch-visual-regression-across-test-run`\n';
    } else {
      md += '**Result:** ✗ Fail.\n\n';
      md += `${failureReason ?? `Report at \`${reportPath}\` missing sections: ${JSON.stringify(inspection.checks)}`}\n`;
    }
    writeFileSync(mdOut, md);
    console.log('\nReport: _context/docs/research/2026-06-01-recipe-wdio-verification-report.md');
  }

  await cleanup();
  process.exit(allOk ? 0 : 1);
}

main().catch((e) => {
  console.error('verify-recipes:wdio crashed:', e);
  process.exit(1);
});
