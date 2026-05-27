// E2E smoke runner (Task 2.17).
//
// The smoke spec FAILS ON PURPOSE — a failed test is the only thing that makes
// TraceLaneService (in `failed` mode) write a report. So `wdio run` returning a
// non-zero exit (because a test failed) is the EXPECTED, healthy outcome here.
// We therefore can't gate on WDIO's exit code; we gate on the report assertion
// in wdio.conf.ts's `onComplete` instead:
//
//   - onComplete throws if no .html report was written or any report >= 25 MB.
//   - A thrown onComplete is surfaced by the Launcher (it rejects / non-zero),
//     so we treat the *absence* of an onComplete error as success.
//
// This script runs WDIO via the programmatic Launcher and maps:
//   report-assertion passed (1 test failed as designed) -> exit 0
//   report-assertion failed / launcher error            -> exit 1
//
// It is invoked by the `test:e2e` package script (after the rrweb bundle build).

import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Launcher } from '@wdio/cli';

const here = dirname(fileURLToPath(import.meta.url));
const configPath = join(here, 'wdio.conf.ts');

// The one spec is expected to fail; this is the count we tolerate.
const EXPECTED_FAILURES = 1;

async function main() {
  const launcher = new Launcher(configPath, {});
  let exitCode;
  try {
    // Launcher resolves with the WDIO exit code (number of failing specs), and
    // rejects if a launcher-level hook (our onComplete report assertion) throws.
    exitCode = await launcher.run();
  } catch (err) {
    // onComplete threw -> the report assertion failed. That is a real failure.
    console.error('\n[tracelane smoke] report assertion FAILED:');
    console.error(err instanceof Error ? (err.stack ?? err.message) : String(err));
    process.exit(1);
  }

  // We get here only if onComplete did NOT throw, i.e. the report exists and is
  // under budget. A non-zero `exitCode` here is just the intentional test
  // failure — expected. A zero exit would mean the smoke test did NOT fail,
  // which is itself wrong (no failure => no report path exercised).
  if (exitCode === 0) {
    console.error(
      '\n[tracelane smoke] UNEXPECTED: the smoke spec passed. It is supposed to fail so a ' +
        'report gets written. Failing the smoke run.',
    );
    process.exit(1);
  }
  if (exitCode > EXPECTED_FAILURES) {
    console.error(
      `\n[tracelane smoke] UNEXPECTED: ${exitCode} specs failed (expected exactly ${EXPECTED_FAILURES}).`,
    );
    process.exit(1);
  }

  console.log('\n[tracelane smoke] PASSED: a report was written and verified < 25 MB.');
  process.exit(0);
}

await main();
