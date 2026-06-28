// `peek retention <set|show|preview|apply>` command shell (P2 PRD §H3.4a). The
// retention policy lives in ~/.peek/policy.json; the prune ENGINE
// (selectPruneCandidates + pruneSessions) is in lib/db.ts and is the single
// source of truth shared by `preview` (read-only) and `apply` (destructive).
//
// Safety contract (P2 PRD §H3): peek NEVER deletes silently. `set`/`show`/
// `preview` never delete; `apply` requires either an interactive y/N confirm
// (default No) or an explicit `--yes`. The engine itself refuses to prune below
// `--keep` most-recent sessions and never touches an active recording unless
// `--include-stale-active` is passed.

import { parseArgs } from 'node:util';
import { openDb } from '@peekdev/mcp/db';
import { type PruneCandidate, pruneSessions, selectPruneCandidates } from '../lib/db.js';
import { parseDuration } from '../lib/duration.js';
import { formatBytes } from '../lib/output.js';
import { defaultDbPath, rrwebEventsDir } from '../lib/peek-home.js';
import { confirm } from '../lib/prompt.js';
import { type RetentionPolicy, clearPolicy, loadPolicy, savePolicy } from '../lib/retention.js';
import { parseSize } from '../lib/size.js';

const USAGE = `Usage: peek retention <set|show|preview|apply> [options]

  set     --max-age <dur> --max-size <size> --keep <n> | --clear
  show
  preview [--max-age <dur>] [--max-size <size>] [--keep <n>]
  apply   [--yes] [--include-stale-active] [overrides...]

Durations: 30m, 1h, 7d, 4w   Sizes: 500MB, 2GB
Pruning frees session event-blob storage; it never deletes an active recording,
and never below --keep most-recent sessions. peek never deletes silently.
`;

function flagsToPolicy(values: {
  'max-age'?: string;
  'max-size'?: string;
  keep?: string;
}): RetentionPolicy {
  const policy: RetentionPolicy = {};
  if (values['max-age'] !== undefined) {
    parseDuration(values['max-age']);
    policy.maxAge = values['max-age'];
  }
  if (values['max-size'] !== undefined) policy.maxSizeBytes = parseSize(values['max-size']);
  if (values.keep !== undefined) {
    const n = Number(values.keep);
    if (!Number.isInteger(n) || n < 0) throw new Error(`invalid --keep "${values.keep}"`);
    policy.keepLast = n;
  }
  return policy;
}

function isEmpty(p: RetentionPolicy): boolean {
  return p.maxAge === undefined && p.maxSizeBytes === undefined;
}

function describePolicy(p: RetentionPolicy): string {
  const parts: string[] = [];
  if (p.maxAge !== undefined) parts.push(`max-age ${p.maxAge}`);
  if (p.maxSizeBytes !== undefined) parts.push(`max-size ${formatBytes(p.maxSizeBytes)}`);
  if (p.keepLast !== undefined) parts.push(`keep-last ${p.keepLast}`);
  return parts.length > 0 ? parts.join(', ') : '(empty)';
}

function printCandidates(candidates: PruneCandidate[]): void {
  for (const c of candidates) {
    process.stdout.write(
      `  ${c.id}  ${c.updatedAt}  ${formatBytes(c.bytes)}  [${c.reasons.join('+')}]\n`,
    );
  }
}

const FLAG_OPTS = {
  'max-age': { type: 'string' },
  'max-size': { type: 'string' },
  keep: { type: 'string' },
  clear: { type: 'boolean' },
  yes: { type: 'boolean' },
  'include-stale-active': { type: 'boolean' },
  help: { type: 'boolean' },
} as const;

export async function runRetention(argv: string[]): Promise<number> {
  const sub = argv[0];
  const rest = argv.slice(1);
  if (sub === undefined || sub === 'help' || sub === '--help' || sub === '-h') {
    process.stdout.write(USAGE);
    return sub === undefined ? 1 : 0;
  }

  let values: {
    'max-age'?: string;
    'max-size'?: string;
    keep?: string;
    clear?: boolean;
    yes?: boolean;
    'include-stale-active'?: boolean;
    help?: boolean;
  };
  try {
    ({ values } = parseArgs({ args: rest, options: FLAG_OPTS, allowPositionals: false }));
  } catch (err) {
    process.stderr.write(`peek retention: ${err instanceof Error ? err.message : String(err)}\n`);
    return 1;
  }
  if (values.help) {
    process.stdout.write(USAGE);
    return 0;
  }

  try {
    switch (sub) {
      case 'set':
        return runSet(values);
      case 'show':
        return runShow();
      case 'preview':
        return runPreview(values);
      case 'apply':
        return await runApply(values);
      default:
        process.stderr.write(`peek retention: unknown subcommand '${sub}'\n`);
        process.stdout.write(USAGE);
        return 1;
    }
  } catch (err) {
    process.stderr.write(`peek retention: ${err instanceof Error ? err.message : String(err)}\n`);
    return 1;
  }
}

function runSet(values: {
  clear?: boolean;
  'max-age'?: string;
  'max-size'?: string;
  keep?: string;
}): number {
  if (values.clear) {
    clearPolicy();
    process.stdout.write('Retention policy cleared.\n');
    return 0;
  }
  const policy = flagsToPolicy(values);
  if (
    policy.maxAge === undefined &&
    policy.maxSizeBytes === undefined &&
    policy.keepLast === undefined
  ) {
    process.stderr.write(
      'peek retention set: pass at least one of --max-age, --max-size, --keep (or --clear)\n',
    );
    return 1;
  }
  savePolicy(policy);
  process.stdout.write(`Retention policy saved: ${describePolicy(policy)}\n`);
  return 0;
}

function runShow(): number {
  const policy = loadPolicy();
  if (policy === null) {
    process.stdout.write('No retention policy configured.\n');
    return 0;
  }
  process.stdout.write(`Retention policy: ${describePolicy(policy)}\n`);
  return 0;
}

function effectivePolicy(values: {
  'max-age'?: string;
  'max-size'?: string;
  keep?: string;
}): RetentionPolicy {
  return { ...(loadPolicy() ?? {}), ...flagsToPolicy(values) };
}

function runPreview(values: {
  'max-age'?: string;
  'max-size'?: string;
  keep?: string;
  'include-stale-active'?: boolean;
}): number {
  const policy = effectivePolicy(values);
  if (isEmpty(policy)) {
    process.stderr.write(
      'peek retention preview: no policy — set one or pass --max-age/--max-size\n',
    );
    return 1;
  }
  const db = openDb({ path: defaultDbPath() });
  try {
    const candidates = selectPruneCandidates(db, policy, Date.now(), {
      includeStaleActive: values['include-stale-active'] === true,
    });
    if (candidates.length === 0) {
      process.stdout.write('Nothing to prune.\n');
      return 0;
    }
    const bytes = candidates.reduce((s, c) => s + c.bytes, 0);
    process.stdout.write(`Would prune ${candidates.length} session(s), ${formatBytes(bytes)}:\n`);
    printCandidates(candidates);
    return 0;
  } finally {
    db.close();
  }
}

async function runApply(values: {
  'max-age'?: string;
  'max-size'?: string;
  keep?: string;
  yes?: boolean;
  'include-stale-active'?: boolean;
}): Promise<number> {
  const policy = effectivePolicy(values);
  if (isEmpty(policy)) {
    process.stderr.write(
      'peek retention apply: no policy — set one or pass --max-age/--max-size\n',
    );
    return 1;
  }
  const db = openDb({ path: defaultDbPath() });
  try {
    const candidates = selectPruneCandidates(db, policy, Date.now(), {
      includeStaleActive: values['include-stale-active'] === true,
    });
    if (candidates.length === 0) {
      process.stdout.write('Nothing to prune.\n');
      return 0;
    }
    const bytes = candidates.reduce((s, c) => s + c.bytes, 0);
    if (values.yes !== true) {
      const ok = await confirm(
        `Delete ${candidates.length} session(s) (${formatBytes(bytes)})?`,
        false,
      );
      if (!ok) {
        process.stdout.write('Aborted.\n');
        return 0;
      }
    }
    const deleted = pruneSessions(
      db,
      candidates.map((c) => c.id),
      rrwebEventsDir(),
    );
    process.stdout.write(
      `Pruned ${deleted} session(s), freed ${formatBytes(bytes)} of event data.\n`,
    );
    return 0;
  } finally {
    db.close();
  }
}
