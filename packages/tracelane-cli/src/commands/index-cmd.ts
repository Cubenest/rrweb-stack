// `tracelane index <dir> [--out <path>]` — scan a directory of tracelane HTML
// reports and emit a single self-contained index page with one metadata card
// per failure. The triage workflow described in
// recipes/triage-ci-run-with-replay-thumbnails depends on this command.
//
// Pure parsing + rendering live in lib/extract-metadata.ts and
// lib/render-index.ts. This file owns: arg parsing, file walking,
// orchestration, exit codes, stdout messaging.

import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { type ExtractedMetadata, extractMetadata } from '../lib/extract-metadata.js';
import { type IndexEntry, renderIndex } from '../lib/render-index.js';

export const INDEX_HELP = `tracelane index - generate a single-file triage index for a directory of reports

Usage: npx tracelane index <dir> [options]

Arguments:
  <dir>                       Directory containing tracelane-report-*.html files (recursive)

Options:
  --out <path>                Output file path (default: <dir>/index.html)
  --sort <field>              Sort cards by 'captured' (default) | 'spec' | 'status'
  --title <text>              Override the index page title
  --help, -h                  Show this help

Exit codes:
  0   index written successfully (even if some reports failed to parse)
  1   <dir> not found or no .html reports inside
  2   bad CLI arguments

Example:
  npx tracelane index ./tracelane-reports
  npx tracelane index ./tracelane-reports --out ./reports-index.html
`;

interface IndexOptions {
  dir: string;
  out: string;
  sort: 'captured' | 'spec' | 'status';
  title?: string;
}

class CliError extends Error {
  constructor(
    message: string,
    public readonly exitCode: number,
  ) {
    super(message);
    this.name = 'CliError';
  }
}

function parseOptions(argv: readonly string[]): IndexOptions {
  let parsed: ReturnType<typeof parseArgs>;
  try {
    parsed = parseArgs({
      args: [...argv],
      options: {
        out: { type: 'string' },
        sort: { type: 'string', default: 'captured' },
        title: { type: 'string' },
        help: { type: 'boolean', short: 'h' },
      },
      allowPositionals: true,
    });
  } catch (e) {
    throw new CliError(`tracelane index: ${e instanceof Error ? e.message : String(e)}`, 2);
  }

  if (parsed.values.help) {
    process.stdout.write(INDEX_HELP);
    throw new CliError('', 0);
  }

  const dir = parsed.positionals[0];
  if (!dir) {
    throw new CliError('tracelane index: missing required <dir> argument\n', 2);
  }

  const sort = parsed.values.sort as IndexOptions['sort'];
  if (!['captured', 'spec', 'status'].includes(sort)) {
    throw new CliError(
      `tracelane index: invalid --sort value '${sort}' (expected captured | spec | status)\n`,
      2,
    );
  }

  const dirAbs = isAbsolute(dir) ? dir : resolve(process.cwd(), dir);
  const outArg = typeof parsed.values.out === 'string' ? parsed.values.out : undefined;
  const out = outArg
    ? isAbsolute(outArg)
      ? outArg
      : resolve(process.cwd(), outArg)
    : join(dirAbs, 'index.html');

  const result: IndexOptions = { dir: dirAbs, out, sort };
  if (typeof parsed.values.title === 'string') result.title = parsed.values.title;
  return result;
}

/** Recursively walk a directory and return every `*.html` file path. */
function findHtmlReports(dir: string): string[] {
  const out: string[] = [];
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch (e) {
    throw new CliError(
      `tracelane index: cannot read directory '${dir}': ${e instanceof Error ? e.message : String(e)}\n`,
      1,
    );
  }
  for (const name of entries) {
    const full = join(dir, name);
    let stat: ReturnType<typeof statSync>;
    try {
      stat = statSync(full);
    } catch {
      continue;
    }
    if (stat.isDirectory()) {
      out.push(...findHtmlReports(full));
    } else if (stat.isFile() && name.endsWith('.html')) {
      out.push(full);
    }
  }
  return out;
}

function statusOrder(status: ExtractedMetadata['status']): number {
  // failed/broken first (most-actionable), then unknown, then passed/skipped.
  switch (status) {
    case 'failed':
      return 0;
    case 'broken':
      return 1;
    case 'unknown':
      return 2;
    case 'skipped':
      return 3;
    case 'passed':
      return 4;
    default:
      return 5;
  }
}

function sortEntries(entries: IndexEntry[], sortBy: IndexOptions['sort']): IndexEntry[] {
  const sorted = [...entries];
  if (sortBy === 'spec') {
    sorted.sort((a, b) => (a.meta?.spec ?? a.filename).localeCompare(b.meta?.spec ?? b.filename));
  } else if (sortBy === 'status') {
    sorted.sort((a, b) => {
      const ao = a.meta ? statusOrder(a.meta.status) : 6;
      const bo = b.meta ? statusOrder(b.meta.status) : 6;
      if (ao !== bo) return ao - bo;
      return (a.meta?.capturedAt ?? '').localeCompare(b.meta?.capturedAt ?? '');
    });
  } else {
    // captured: descending so newest-first
    sorted.sort((a, b) => (b.meta?.capturedAt ?? '').localeCompare(a.meta?.capturedAt ?? ''));
  }
  return sorted;
}

export async function runIndex(argv: readonly string[]): Promise<number> {
  let options: IndexOptions;
  try {
    options = parseOptions(argv);
  } catch (e) {
    if (e instanceof CliError) {
      if (e.message) process.stderr.write(e.message);
      return e.exitCode;
    }
    throw e;
  }

  let files: string[];
  try {
    files = findHtmlReports(options.dir);
  } catch (e) {
    if (e instanceof CliError) {
      process.stderr.write(e.message);
      return e.exitCode;
    }
    throw e;
  }

  // Exclude any prior index.html (don't index ourselves).
  files = files.filter((f) => f !== options.out);

  if (files.length === 0) {
    process.stderr.write(`tracelane index: no .html reports found in '${options.dir}'\n`);
    return 1;
  }

  const outDir = dirname(options.out);
  const entries: IndexEntry[] = files.map((full) => {
    const html = readFileSync(full, 'utf8');
    const meta = extractMetadata(html);
    // Relativise the filename against the index's output directory so the
    // <a href> works regardless of where the index lands.
    const rel = full.startsWith(`${outDir}/`) ? full.slice(outDir.length + 1) : full;
    return { filename: rel, meta };
  });

  const parsed = entries.filter((e) => e.meta).length;
  const unparsed = entries.length - parsed;

  const sorted = sortEntries(entries, options.sort);
  const renderInput: Parameters<typeof renderIndex>[0] = { entries: sorted };
  if (options.title) renderInput.title = options.title;
  const html = renderIndex(renderInput);

  try {
    writeFileSync(options.out, html, 'utf8');
  } catch (e) {
    process.stderr.write(
      `tracelane index: failed to write '${options.out}': ${e instanceof Error ? e.message : String(e)}\n`,
    );
    return 1;
  }

  process.stdout.write(
    `tracelane index: wrote ${options.out} (${parsed} parsed, ${unparsed} unparsed of ${entries.length} reports)\n`,
  );
  return 0;
}
