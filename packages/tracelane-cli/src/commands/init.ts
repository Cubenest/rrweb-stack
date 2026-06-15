// `tracelane init` — the wedge amplifier. One npx invocation replaces the
// previous "npm install + manually edit wdio.conf.ts" two-step.
//
// Steps:
//   1. Detect runner (or honour --runner) in process.cwd().
//   2. Detect package manager from lockfile presence.
//   3. For WDIO: ask, then install @tracelane/wdio + edit conf + mkdir
//      ./tracelane-reports/ + append to .gitignore.
//   4. For Playwright: ask, then install @tracelane/playwright + register the
//      reporter in playwright.config + mkdir ./tracelane-reports/ + append to
//      .gitignore + print the fixture-import follow-up the user must apply by
//      hand (the CLI can't safely rewrite every spec file).
//   5. For Cypress: print "not yet supported" + a tracking issue link, install
//      nothing, exit 0 (the @tracelane/cypress adapter isn't published yet).
//
// Side effects (mkdirSync, writeFileSync, the package-manager spawn) are
// gated behind --dry-run and an interactive confirm prompt (suppressed by
// --yes). The package-manager spawn is injectable so tests don't hit the
// real npm registry.

import { type SpawnSyncReturns, spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import {
  type DetectedPackageManager,
  type DetectedRunner,
  type Runner,
  detectPackageManager,
  detectRunner,
  findRunnerConfig,
  installCommand,
} from '../lib/detect.js';
import { hasTracelaneEntry, mergeGitignore } from '../lib/gitignore.js';
import {
  FIXTURE_IMPORT_FOLLOWUP,
  MANUAL_SNIPPET as PLAYWRIGHT_MANUAL_SNIPPET,
  applyPlaywrightEdit,
} from '../lib/playwright-editor.js';
import { confirm } from '../lib/prompt.js';
import { MANUAL_SNIPPET, applyWdioEdit } from '../lib/wdio-editor.js';

/** The npm package that provides each runner's tracelane adapter. */
const RUNNER_PACKAGE: Record<'wdio' | 'playwright', string> = {
  wdio: '@tracelane/wdio',
  playwright: '@tracelane/playwright',
};

/** Issues board for tracking the not-yet-shipped Playwright/Cypress paths. */
const ISSUES_BOARD = 'https://github.com/Cubenest/rrweb-stack/issues';

/** Spawn-sync signature, narrowed to what we need + injectable for tests. */
export type SpawnRunner = (
  program: string,
  args: readonly string[],
  options: { cwd: string; stdio: 'inherit' | 'pipe'; env?: NodeJS.ProcessEnv },
) => SpawnSyncReturns<Buffer>;

const realSpawn: SpawnRunner = (program, args, options) =>
  spawnSync(program, args as string[], options);

/** Options accepted by the testable `runInitProgrammatic` entrypoint. */
export interface InitOptions {
  /** Project root the CLI was invoked in (process.cwd() for production). */
  readonly cwd: string;
  /** User-passed --runner override; undefined → auto-detect. */
  readonly runner?: Runner | undefined;
  /** --dry-run: print but don't modify anything. */
  readonly dryRun?: boolean;
  /** --yes: skip the confirmation prompt. */
  readonly yes?: boolean;
  /** --skip-install: don't run the package-manager install. */
  readonly skipInstall?: boolean;
  /** Where to write stdout (defaults to process.stdout). */
  readonly stdout?: NodeJS.WritableStream;
  /** Where to write stderr (defaults to process.stderr). */
  readonly stderr?: NodeJS.WritableStream;
  /** Override the spawn function (tests stub this so we don't hit npm). */
  readonly spawn?: SpawnRunner;
}

/** Wrap process.stdout.write so we can swap in a fake in tests. */
function write(s: NodeJS.WritableStream | undefined, msg: string): void {
  (s ?? process.stdout).write(msg);
}

/** Stderr variant. */
function writeErr(s: NodeJS.WritableStream | undefined, msg: string): void {
  (s ?? process.stderr).write(msg);
}

/** Pretty-print the package-manager install command for the user. */
function commandString(cmd: readonly string[]): string {
  return cmd.join(' ');
}

/** Step description for the "About to" summary. */
interface PlannedStep {
  readonly index: number;
  readonly description: string;
}

function describeSteps(
  detected: DetectedRunner,
  pm: DetectedPackageManager,
  options: { skipInstall: boolean; gitignoreExists: boolean; pkg: string },
): PlannedStep[] {
  const steps: PlannedStep[] = [];
  let i = 1;
  if (!options.skipInstall) {
    steps.push({
      index: i++,
      description: commandString(installCommand(pm.manager, options.pkg)),
    });
  }
  steps.push({
    index: i++,
    description:
      detected.runner === 'playwright'
        ? `Edit ${basename(detected.configPath)} to register the tracelane reporter`
        : `Edit ${basename(detected.configPath)} to register the Service`,
  });
  steps.push({ index: i++, description: 'Create ./tracelane-reports/' });
  steps.push({
    index: i++,
    description: options.gitignoreExists
      ? 'Append tracelane-reports/ to .gitignore'
      : 'Create .gitignore with tracelane-reports/',
  });
  return steps;
}

/** node:path.basename without the import — we only need it for log lines. */
function basename(p: string): string {
  return p.split(/[/\\]/).pop() ?? p;
}

/**
 * Print the not-yet-supported message for Cypress. Exits 0 (no error — the
 * user has a valid project, the @tracelane/cypress adapter just isn't published
 * yet, so there's nothing to wire).
 */
function printCypressUnsupported(
  detected: DetectedRunner,
  stdout: NodeJS.WritableStream | undefined,
): number {
  write(
    stdout,
    [
      `tracelane init - detected Cypress project (${basename(detected.configPath)}).`,
      '',
      'Cypress is not yet supported: the @tracelane/cypress adapter has not been',
      'published. WebdriverIO and Playwright are wired today.',
      `Track progress: ${ISSUES_BOARD}`,
      '',
      'To use tracelane now, run it against a WebdriverIO or Playwright suite',
      '(pass --runner wdio / --runner playwright if your project has both).',
      '',
    ].join('\n'),
  );
  return 0;
}

/**
 * The pure-ish programmatic entrypoint. Tests call this directly with a
 * fake cwd + fake spawn; the bin shell calls `runInit(argv)` which forwards
 * to here with process.cwd() + the real spawn.
 *
 * Returns the process exit code (0 = success / coming-soon, 1 = nothing
 * matched or a hard error).
 */
export async function runInitProgrammatic(opts: InitOptions): Promise<number> {
  const stdout = opts.stdout;
  const stderr = opts.stderr;
  const spawn = opts.spawn ?? realSpawn;
  const cwd = opts.cwd;

  // ---- Runner resolution -------------------------------------------------

  let detected: DetectedRunner | undefined;
  if (opts.runner !== undefined) {
    // --runner forces the choice; we still try to find a config file so the
    // editor has something to point at.
    const configPath = findRunnerConfig(cwd, opts.runner);
    if (configPath === undefined) {
      // WDIO + Playwright need a config file to edit; Cypress needs one to
      // confirm the project shape before printing the not-yet-supported note.
      // Either way, a missing config for the forced runner is a hard error.
      writeErr(
        stderr,
        `tracelane init: --runner ${opts.runner} was passed, but no matching config file found in ${cwd}.\n`,
      );
      return 1;
    }
    detected = { runner: opts.runner, configPath };
  } else {
    detected = detectRunner(cwd);
    if (detected === undefined) {
      writeErr(
        stderr,
        `tracelane init: No supported test runner detected in ${cwd}. Run from your project root, or pass \`--runner wdio\` explicitly.\n`,
      );
      return 1;
    }
  }

  // ---- Runner-specific routing ------------------------------------------

  // Cypress is detected but not yet wired (adapter unpublished).
  if (detected.runner === 'cypress') {
    return printCypressUnsupported(detected, stdout);
  }

  // WDIO + Playwright share the same scaffold flow; the per-runner details
  // (install package, config editor, success CTA, fixture follow-up) are
  // captured below.
  const runner = detected.runner;
  const pkg = RUNNER_PACKAGE[runner];
  const runnerLabel = runner === 'playwright' ? 'Playwright' : 'WebdriverIO';

  const pm = detectPackageManager(cwd);
  const gitignorePath = join(cwd, '.gitignore');
  const gitignoreExists = existsSync(gitignorePath);
  const skipInstall = opts.skipInstall ?? false;

  write(
    stdout,
    `tracelane init - detected ${runnerLabel} project (${basename(detected.configPath)}) using ${pm.manager}.\n\n`,
  );

  if (pm.multipleLockfiles) {
    write(
      stdout,
      `Note: multiple lockfiles detected (${pm.lockfilesFound.join(', ')}); using ${pm.manager}.\n\n`,
    );
  }
  if (pm.fallback) {
    write(stdout, 'Note: no lockfile detected; defaulting to npm.\n\n');
  }

  const steps = describeSteps(detected, pm, { skipInstall, gitignoreExists, pkg });
  write(stdout, opts.dryRun ? 'DRY RUN — would do:\n' : 'About to:\n');
  for (const s of steps) {
    write(stdout, `  ${s.index}. ${opts.dryRun ? 'WOULD: ' : ''}${s.description}\n`);
  }
  write(stdout, '\n');

  if (opts.dryRun) {
    // Show the conf-edit preview without writing.
    const preview =
      runner === 'playwright'
        ? previewPlaywrightEdit(detected.configPath)
        : previewConfEdit(detected.configPath);
    if (preview !== undefined) write(stdout, preview);
    if (runner === 'playwright') {
      write(stdout, `Manual follow-up after init:\n${FIXTURE_IMPORT_FOLLOWUP}\n\n`);
    }
    write(stdout, 'Dry run complete; no files changed.\n');
    return 0;
  }

  if (!opts.yes) {
    const proceed = await confirm('Continue?', true);
    if (!proceed) {
      write(stdout, 'Aborted.\n');
      return 0;
    }
  }

  // ---- Execute the steps ------------------------------------------------

  if (!skipInstall) {
    const cmd = installCommand(pm.manager, pkg);
    const [program, ...args] = cmd;
    if (program === undefined) {
      writeErr(stderr, 'tracelane init: empty install command (internal error).\n');
      return 1;
    }
    write(stdout, `Running: ${commandString(cmd)}\n`);
    const result = spawn(program, args, { cwd, stdio: 'inherit' });
    if (result.error) {
      writeErr(stderr, `tracelane init: install failed to launch: ${result.error.message}\n`);
      return 1;
    }
    if (result.status !== 0) {
      writeErr(
        stderr,
        `tracelane init: install exited with code ${result.status}. Re-run with --skip-install once you've added ${pkg} manually.\n`,
      );
      return 1;
    }
    write(stdout, '\n');
  }

  // Edit the runner config in place. Back-out path keeps a one-shot .backup
  // next to the config so the user can restore on their own if anything
  // looks wrong after the run.
  const editOutcome =
    runner === 'playwright'
      ? editPlaywrightConfigOnDisk(detected.configPath)
      : editWdioConfOnDisk(detected.configPath);
  if (editOutcome.kind === 'manual') {
    write(
      stdout,
      [
        `! Could not auto-edit ${basename(detected.configPath)}: ${editOutcome.reason}`,
        '  Paste the following into your conf manually:',
        '',
        ...editOutcome.snippet.split('\n').map((l) => `    ${l}`),
        '',
        '  The rest of init (reports dir + .gitignore) still ran.',
        '',
      ].join('\n'),
    );
  } else if (editOutcome.kind === 'restored') {
    write(
      stdout,
      [
        `! Auto-edit of ${basename(detected.configPath)} failed sanity check; original restored.`,
        `  Backup kept at ${basename(editOutcome.backupPath)} for one-shot recovery.`,
        '  Paste the following manually:',
        '',
        ...editOutcome.snippet.split('\n').map((l) => `    ${l}`),
        '',
      ].join('\n'),
    );
  } else if (editOutcome.kind === 'alreadyConfigured') {
    write(
      stdout,
      runner === 'playwright'
        ? `* ${basename(detected.configPath)} already registers the @tracelane/playwright reporter; left it alone.\n`
        : `* ${basename(detected.configPath)} already wires TraceLaneService; left it alone.\n`,
    );
  } else {
    write(stdout, `+ Edited ${basename(detected.configPath)}.\n`);
  }

  // mkdir is idempotent with `recursive: true`.
  const reportsDir = join(cwd, 'tracelane-reports');
  mkdirSync(reportsDir, { recursive: true });
  write(stdout, '+ Created ./tracelane-reports/\n');

  // .gitignore: read-modify-write iff our entry isn't already there.
  let gitignoreExisting = '';
  if (existsSync(gitignorePath)) {
    gitignoreExisting = readFileSync(gitignorePath, 'utf8');
  }
  if (hasTracelaneEntry(gitignoreExisting)) {
    write(stdout, '* .gitignore already lists tracelane-reports/; left it alone.\n');
  } else {
    const merged = mergeGitignore(gitignoreExisting);
    writeFileSync(gitignorePath, merged, 'utf8');
    write(
      stdout,
      gitignoreExisting.length === 0
        ? '+ Created .gitignore with tracelane-reports/\n'
        : '+ Appended tracelane-reports/ to .gitignore\n',
    );
  }

  // Final message — the "next: " call to action. Include a literal,
  // copy-paste-ready command so the user knows exactly what to run, with
  // the conf filename matching what we detected (handles .js/.mjs/.cjs).
  const ok = process.stdout.isTTY ? '✔' : 'OK';
  if (runner === 'playwright') {
    // Playwright needs a SECOND, manual edit the CLI can't do safely: every
    // spec must import tracelane's fixture instead of @playwright/test. Print
    // it prominently so the user doesn't miss it.
    write(
      stdout,
      [
        '',
        `${ok} reporter registered.`,
        '',
        "ONE MANUAL STEP LEFT — the recording is driven by tracelane's test fixture,",
        "which the CLI can't safely add to your spec files for you:",
        '',
        ...FIXTURE_IMPORT_FOLLOWUP.split('\n').map((l) => `  ${l}`),
        '',
        'Then run your suite: npx playwright test',
        'On a failing test you get',
        './tracelane-reports/<spec>--<title>--<project>-<ts>.html — open it in any browser.',
        '',
        'Docs: https://github.com/Cubenest/rrweb-stack/tree/main/packages/tracelane-playwright',
        '',
      ].join('\n'),
    );
  } else {
    write(
      stdout,
      [
        '',
        `${ok} done.`,
        `Run: npx wdio run ${basename(detected.configPath)}`,
        'On a failing Chrome test you get',
        './tracelane-reports/<spec>--<title>.html — open it in any browser.',
        '',
        'Docs: https://github.com/Cubenest/rrweb-stack/tree/main/packages/tracelane-wdio',
        '',
      ].join('\n'),
    );
  }

  return 0;
}

/**
 * Read a wdio.conf, attempt the edit, and on success write the new content
 * back. On failure to even find a place to insert (manual-snippet path),
 * the file on disk is untouched. On sanity-check failure AFTER write, the
 * original is restored from the in-memory backup and a `.backup` file is
 * left next to the conf for the user to inspect.
 */
type EditOutcomeOnDisk =
  | { readonly kind: 'edited' }
  | { readonly kind: 'alreadyConfigured' }
  | { readonly kind: 'manual'; readonly reason: string; readonly snippet: string }
  | {
      readonly kind: 'restored';
      readonly reason: string;
      readonly snippet: string;
      readonly backupPath: string;
    };

function editWdioConfOnDisk(configPath: string): EditOutcomeOnDisk {
  const original = readFileSync(configPath, 'utf8');
  const result = applyWdioEdit(original);
  if (!result.ok) {
    // Pure-function back-out: the editor never touched anything; just report.
    return { kind: 'manual', reason: result.reason, snippet: result.manualSnippet };
  }
  if (result.alreadyConfigured) {
    return { kind: 'alreadyConfigured' };
  }
  // Belt-and-braces: persist the original to a .backup before overwriting,
  // then sanity-check what we wrote by reading it back. If the read-back
  // doesn't match what we expected, restore.
  const backupPath = `${configPath}.tracelane-init.backup`;
  writeFileSync(backupPath, original, 'utf8');
  writeFileSync(configPath, result.source, 'utf8');
  const verifyContent = readFileSync(configPath, 'utf8');
  if (verifyContent !== result.source) {
    // Disk corruption is exceedingly unlikely but we'd rather catch it.
    renameSync(backupPath, configPath);
    return {
      kind: 'restored',
      reason: 'post-write read-back did not match expected content',
      // Single source of truth — defined alongside the editor's back-out
      // path so the snippet copy can't drift.
      snippet: MANUAL_SNIPPET,
      backupPath,
    };
  }
  // Edit succeeded; clean up the backup since the live file is good.
  try {
    unlinkSync(backupPath);
  } catch {
    // Non-fatal; the leftover .backup is harmless.
  }
  return { kind: 'edited' };
}

/** Build the WOULD-BE diff preview shown by --dry-run. */
function previewConfEdit(configPath: string): string | undefined {
  let original: string;
  try {
    original = readFileSync(configPath, 'utf8');
  } catch {
    return undefined;
  }
  const result = applyWdioEdit(original);
  if (!result.ok) {
    return `Would back out of conf edit: ${result.reason}\n  Manual snippet:\n${result.manualSnippet
      .split('\n')
      .map((l) => `    ${l}`)
      .join('\n')}\n\n`;
  }
  if (result.alreadyConfigured) {
    return `Would leave ${basename(configPath)} alone (already wires TraceLaneService).\n\n`;
  }
  // Show a compact summary of what would change instead of a full diff —
  // the byte delta is small and the user can diff themselves if they want.
  const importLine = result.addedImport
    ? "+ import TraceLaneService from '@tracelane/wdio';\n"
    : '';
  const entryLine = result.addedServiceEntry
    ? "+ services: [..., [TraceLaneService, { mode: 'failed' }]]\n"
    : '';
  return `Conf edit preview (${basename(configPath)}):\n${importLine}${entryLine}\n`;
}

/**
 * Playwright analogue of `editWdioConfOnDisk`. Reads the playwright.config,
 * registers the tracelane reporter, and on success writes the new content
 * back with the same backup/sanity-check/restore discipline. On a clean
 * back-out (unrecognised config shape) the file on disk is untouched.
 */
function editPlaywrightConfigOnDisk(configPath: string): EditOutcomeOnDisk {
  const original = readFileSync(configPath, 'utf8');
  const result = applyPlaywrightEdit(original);
  if (!result.ok) {
    return { kind: 'manual', reason: result.reason, snippet: result.manualSnippet };
  }
  if (result.alreadyConfigured) {
    return { kind: 'alreadyConfigured' };
  }
  const backupPath = `${configPath}.tracelane-init.backup`;
  writeFileSync(backupPath, original, 'utf8');
  writeFileSync(configPath, result.source, 'utf8');
  const verifyContent = readFileSync(configPath, 'utf8');
  if (verifyContent !== result.source) {
    renameSync(backupPath, configPath);
    return {
      kind: 'restored',
      reason: 'post-write read-back did not match expected content',
      snippet: PLAYWRIGHT_MANUAL_SNIPPET,
      backupPath,
    };
  }
  try {
    unlinkSync(backupPath);
  } catch {
    // Non-fatal; the leftover .backup is harmless.
  }
  return { kind: 'edited' };
}

/** Build the WOULD-BE preview shown by --dry-run for a Playwright config. */
function previewPlaywrightEdit(configPath: string): string | undefined {
  let original: string;
  try {
    original = readFileSync(configPath, 'utf8');
  } catch {
    return undefined;
  }
  const result = applyPlaywrightEdit(original);
  if (!result.ok) {
    return `Would back out of config edit: ${result.reason}\n  Manual snippet:\n${result.manualSnippet
      .split('\n')
      .map((l) => `    ${l}`)
      .join('\n')}\n\n`;
  }
  if (result.alreadyConfigured) {
    return `Would leave ${basename(configPath)} alone (already registers the @tracelane/playwright reporter).\n\n`;
  }
  return `Config edit preview (${basename(configPath)}):\n+ reporter: [..., ['@tracelane/playwright', { mode: 'failed' }]]\n\n`;
}

/** Help text for `tracelane init --help`. */
export const INIT_HELP = `tracelane init - wire tracelane into the test project in this directory.

Usage: npx @tracelane/cli init [options]   (one-off; recommended)
       tracelane init [options]            (after 'npm i -D @tracelane/cli')

Options:
  --runner <name>      Force runner choice (wdio|playwright|cypress).
                       Default: auto-detected from project files.
  --dry-run            Print what would happen; change nothing.
  --yes, -y            Skip the "about to do X, Y, Z - continue?" prompt.
  --skip-install       Don't run the package-manager install command.
                       Useful if you already have the adapter installed.
  --help, -h           Show this help.

The CLI scans the current working directory for a runner config:

  WebdriverIO   wdio.conf.{ts,js,mjs,cjs}        adds @tracelane/wdio,
                                                 inserts the service tuple
  Playwright    playwright.config.{ts,js,mjs,cjs}  adds @tracelane/playwright,
                                                 registers the reporter
  Cypress       cypress.config.*                 detected, not yet supported

It adds the adapter as a devDependency via the detected package manager
(pnpm/yarn/npm/bun), edits the config, creates ./tracelane-reports/, and
appends to .gitignore. Idempotent: re-running on an already-wired project is a
no-op.

Playwright also needs a one-time manual step the CLI can't do for you: change
your spec imports to tracelane's fixture --
  import { test, expect } from '@tracelane/playwright/fixture';
init prints this reminder after it finishes.

Auto-edit limitation: the editors use string regex to insert into the
services / reporter array. If they can't recognise the shape they BACK OUT
cleanly and print the snippet to paste manually - they NEVER corrupt your config.
`;

/**
 * Argv entry for `tracelane init`. Parses flags via node:util.parseArgs and
 * delegates to runInitProgrammatic.
 */
export async function runInit(argv: readonly string[]): Promise<number> {
  let parsed: ReturnType<
    typeof parseArgs<{
      options: {
        runner: { type: 'string' };
        'dry-run': { type: 'boolean' };
        yes: { type: 'boolean'; short: 'y' };
        'skip-install': { type: 'boolean' };
        help: { type: 'boolean'; short: 'h' };
      };
    }>
  >;
  try {
    parsed = parseArgs({
      args: [...argv],
      options: {
        runner: { type: 'string' },
        'dry-run': { type: 'boolean' },
        yes: { type: 'boolean', short: 'y' },
        'skip-install': { type: 'boolean' },
        help: { type: 'boolean', short: 'h' },
      },
      allowPositionals: false,
    });
  } catch (err) {
    process.stderr.write(
      `tracelane init: ${err instanceof Error ? err.message : String(err)}\n\n${INIT_HELP}`,
    );
    return 1;
  }

  if (parsed.values.help) {
    process.stdout.write(INIT_HELP);
    return 0;
  }

  const rawRunner = parsed.values.runner;
  let runner: Runner | undefined;
  if (rawRunner !== undefined) {
    if (rawRunner !== 'wdio' && rawRunner !== 'playwright' && rawRunner !== 'cypress') {
      process.stderr.write(
        `tracelane init: --runner must be one of wdio|playwright|cypress (got '${rawRunner}').\n`,
      );
      return 1;
    }
    runner = rawRunner;
  }

  return runInitProgrammatic({
    cwd: process.cwd(),
    runner,
    dryRun: parsed.values['dry-run'] ?? false,
    yes: parsed.values.yes ?? false,
    skipInstall: parsed.values['skip-install'] ?? false,
  });
}
