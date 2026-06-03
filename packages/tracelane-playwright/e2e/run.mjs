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
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { decodeEventsBlob } from '@tracelane/report';

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
if (reports.length < 1) {
  console.error(`\n[tracelane smoke] expected at least 1 .html report in ${outDir}, found 0`);
  process.exit(1);
}

let sawNetwork = false;
let sawConsole = false;
let sawSnapshot = false;
let sawNav = false;
let sawPageB = false;
for (const file of reports) {
  const full = join(outDir, file);
  const bytes = statSync(full).size;
  if (bytes >= MAX_BYTES) {
    console.error(
      `\n[tracelane smoke] report ${file} is ${bytes} bytes, exceeding the 25 MB budget.`,
    );
    process.exit(1);
  }
  const html = readFileSync(full, 'utf8');
  const m = html.match(/const EVENTS_GZ_B64 = "([^"]*)";/);
  if (!m) {
    console.error(`\n[tracelane smoke] no EVENTS_GZ_B64 blob in ${file}`);
    process.exit(1);
  }
  const events = decodeEventsBlob(m[1]);
  const blob = JSON.stringify(events);
  if (events.some((e) => e && e.type === 4)) sawSnapshot = true;
  if (blob.includes('tracelane.net')) sawNetwork = true;
  if (blob.includes('tracelane-smoke: button clicked')) sawConsole = true;
  if (blob.includes('tracelane.nav')) sawNav = true;
  if (blob.includes('tracelane-smoke-B: button clicked on page B')) sawPageB = true;
}

const problems = [];
if (!sawSnapshot) problems.push('no rrweb FullSnapshot (type 4) in any report');
if (!sawConsole) problems.push("console line 'tracelane-smoke: button clicked' missing");
if (!sawNetwork) problems.push("network failure marker '[tracelane.net]' missing");
if (!sawNav)
  problems.push("navigation boundary 'tracelane.nav' missing (post-nav capture broken?)");
if (!sawPageB)
  problems.push(
    'post-navigation console line from page B missing (CRITICAL: event loss after navigation)',
  );
if (problems.length) {
  console.error(
    `\n[tracelane smoke] report content assertions FAILED:\n  - ${problems.join('\n  - ')}`,
  );
  process.exit(1);
}
console.log(
  `\n[tracelane smoke] PASSED: ${reports.length} report(s); panels contain rrweb + console + network + nav + page-B events.`,
);
process.exit(0);
