// E2E smoke runner (Task 12).
//
// The smoke spec FAILS ON PURPOSE — a failed test is the only thing that makes
// the auto-fixture (in `failed` mode) write a report. So Playwright exiting
// non-zero (one test failed) is the EXPECTED, healthy outcome. We therefore
// don't gate on Playwright's exit code; we gate on the report assertion below:
// exactly one .html under e2e-out, each < 25 MB.
//
// The fixture resolves its outDir from TRACELANE_OUT_DIR (it doesn't see the
// reporter's config `outDir`), so we set TRACELANE_OUT_DIR to the e2e-out dir
// before spawning the Playwright CLI, and assert against that same dir.

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, rmSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const configPath = join(here, 'playwright.config.ts');
const outDir = join(here, 'e2e-out');
const MAX_BYTES = 25 * 1024 * 1024;

// Start from a clean output dir so a stale report can't mask a real regression.
rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });

const result = spawnSync(
  process.execPath,
  [
    join(here, '..', 'node_modules', '@playwright', 'test', 'cli.js'),
    'test',
    '--config',
    configPath,
  ],
  {
    cwd: join(here, '..'),
    stdio: 'inherit',
    env: { ...process.env, TRACELANE_OUT_DIR: outDir },
  },
);

if (result.error) {
  console.error('\n[tracelane smoke] failed to launch Playwright:', result.error);
  process.exit(1);
}

// A non-zero exit here is just the intentional test failure — expected. An exit
// code of 0 would mean the smoke spec did NOT fail, which is itself wrong (no
// failure => the report path was never exercised).
if (result.status === 0) {
  console.error(
    '\n[tracelane smoke] UNEXPECTED: the smoke spec passed. It is supposed to fail so a ' +
      'report gets written. Failing the smoke run.',
  );
  process.exit(1);
}

if (!existsSync(outDir)) {
  console.error(`\n[tracelane smoke] report dir ${outDir} does not exist.`);
  process.exit(1);
}

const reports = readdirSync(outDir).filter((f) => f.endsWith('.html'));
if (reports.length !== 1) {
  console.error(
    `\n[tracelane smoke] expected exactly 1 .html report in ${outDir}, found ${reports.length}: ${reports.join(', ')}`,
  );
  process.exit(1);
}

const bytes = statSync(join(outDir, reports[0])).size;
if (bytes >= MAX_BYTES) {
  console.error(
    `\n[tracelane smoke] report ${reports[0]} is ${bytes} bytes, exceeding the 25 MB budget.`,
  );
  process.exit(1);
}

console.log(
  `\n[tracelane smoke] PASSED: 1 report written (${reports[0]}, ${bytes} bytes < 25 MB).`,
);
process.exit(0);
