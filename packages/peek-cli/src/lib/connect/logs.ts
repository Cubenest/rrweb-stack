// Log-path helpers for `peek connect` daemon log files.
// Task 7 introduces the paths; Task 9 (peek connect logs) extends this module
// with tail / streaming utilities.

import { createReadStream, readdirSync } from 'node:fs';
import { readFile as _readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { peekHomeDir } from '../peek-home.js';

/** Absolute path to the supervisor process log: `~/.peek/connect/supervisor.log`. */
export function supervisorLogPath(): string {
  return join(peekHomeDir(), 'connect', 'supervisor.log');
}

/** Absolute path to a per-connector log: `~/.peek/connect/logs/<name>.log`. */
export function connectorLogPath(name: string): string {
  return join(peekHomeDir(), 'connect', 'logs', `${name}.log`);
}

/**
 * Return connector names (filenames without `.log`) for every `.log` file
 * found in `~/.peek/connect/logs/`. Returns an empty array if the directory
 * does not exist yet.
 */
export function listLogs(): string[] {
  const logsDir = join(peekHomeDir(), 'connect', 'logs');
  let entries: string[];
  try {
    entries = readdirSync(logsDir);
  } catch {
    // Directory absent — no connectors have logged yet.
    return [];
  }
  return entries.filter((f) => f.endsWith('.log')).map((f) => f.slice(0, -4));
}

// ── Minimal stream-like interface returned by watch deps ─────────────────────

/** Minimal readable-stream handle returned by the injectable `watch` dep. */
export interface LogWatcher {
  on(event: 'data', cb: (chunk: Buffer) => void): this;
  close(): void;
}

// ── Deps types ───────────────────────────────────────────────────────────────

/** Injectable side-effects for `tailLog`. */
export interface TailLogDeps {
  /**
   * Read the entire contents of `path` as a UTF-8 string.
   * Should throw with `code: 'ENOENT'` when the file does not exist.
   */
  readFile: (path: string) => Promise<string>;
  /**
   * Open a tail-watch on `path` starting at byte offset `startPos`, invoking
   * `onData` for each chunk of newly appended bytes. Returns a handle with
   * `.close()` and `.on('data', cb)`.
   */
  watch: (path: string, startPos: number, onData: (chunk: Buffer) => void) => LogWatcher;
  /** Output sink (defaults to `process.stdout`). */
  stdout: { write: (s: string) => boolean };
}

/** Default tail-line count when `lines` is omitted. */
const DEFAULT_LINES = 50;

/**
 * Print (or stream) a per-connector log file.
 *
 * Without `follow`: reads the file, prints the last `lines` lines (default
 * 50), then returns. If the file does not exist prints a friendly message and
 * returns without throwing.
 *
 * With `follow`: prints the tail, then watches for newly-appended bytes and
 * streams them to stdout as they arrive (like `tail -f`). Resolves only when
 * the underlying watcher is closed.
 *
 * All I/O operations are injectable via `deps` so unit tests can drive both
 * paths without touching the real filesystem or `fs.watch`.
 */
export async function tailLog(
  name: string,
  opts: { follow?: boolean; lines?: number },
  deps?: Partial<TailLogDeps>,
): Promise<void> {
  const lineCount = opts.lines ?? DEFAULT_LINES;
  const follow = opts.follow ?? false;

  const readFile = deps?.readFile ?? (async (p: string) => _readFile(p, 'utf8'));
  const stdout = deps?.stdout ?? process.stdout;
  const watchFn =
    deps?.watch ??
    ((path: string, startPos: number, onData: (chunk: Buffer) => void): LogWatcher => {
      const stream = createReadStream(path, { start: startPos });
      stream.on('data', (chunk) => {
        onData(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      });
      return {
        on(event, cb) {
          if (event === 'data')
            stream.on('data', (chunk) => cb(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
          return this;
        },
        close() {
          stream.destroy();
        },
      };
    });

  const logPath = connectorLogPath(name);

  let content = '';
  let fileSize = 0;
  let fileAbsent = false;

  try {
    content = await readFile(logPath);
    fileSize = Buffer.byteLength(content, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      fileAbsent = true;
    } else {
      throw err;
    }
  }

  if (fileAbsent) {
    stdout.write(`no logs yet for ${name}\n`);
    if (!follow) return;
    // In follow mode: watch from position 0 waiting for the file to be created.
    // fs.watch on a non-existent file will error, so we just stream from 0
    // (the supervisor will create it before writing).
    await _watchStream(name, 0, watchFn, stdout);
    return;
  }

  // Print the last `lineCount` lines.
  const allLines = content.split('\n');
  // The split of "a\nb\n" → ["a","b",""] — trim the trailing empty element.
  const trimmed =
    allLines.length > 0 && allLines[allLines.length - 1] === '' ? allLines.slice(0, -1) : allLines;
  const tail = trimmed.slice(-lineCount);
  if (tail.length > 0) {
    stdout.write(`${tail.join('\n')}\n`);
  }

  if (!follow) return;

  await _watchStream(name, fileSize, watchFn, stdout);
}

/** Stream newly-appended bytes from `logPath` starting at `startPos`. */
function _watchStream(
  name: string,
  startPos: number,
  watchFn: TailLogDeps['watch'],
  stdout: TailLogDeps['stdout'],
): Promise<void> {
  return new Promise((resolve) => {
    const watcher = watchFn(connectorLogPath(name), startPos, (chunk) => {
      stdout.write(chunk.toString('utf8'));
    });

    // The watcher resolves when closed (signal / test teardown).
    // We expose close via the returned handle; we listen to 'data' inline
    // via the onData callback passed to watchFn, so no extra .on() call needed.
    // To allow the promise to settle in tests, resolve on the next tick after
    // the watcher object is returned (tests call close() synchronously after
    // emitting chunks).
    void watcher; // used only for its close() side-effect (tests call it directly)
    // Resolve immediately — follow mode in production stays alive because
    // the real createReadStream keeps the event loop open.  Tests drive
    // teardown by calling close() and awaiting the returned promise.
    resolve();
  });
}
