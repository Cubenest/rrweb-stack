// Log-path helpers for `peek connect` daemon log files.
// Task 7 introduces the paths; Task 9 (peek connect logs) extends this module
// with tail / streaming utilities.

import { createReadStream, watch as fsWatch, readdirSync } from 'node:fs';
import { readFile as _readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { peekHomeDir } from '../peek-home.js';

// ── Injectable seam for the default watchFn ───────────────────────────────────

/**
 * Injectable replacement for `fs.watch` used by the DEFAULT `watchFn`.
 * Production code leaves this undefined (falls back to the real `fsWatch`).
 * Tests inject a deterministic fake to exercise the real error-handling code
 * paths (synchronous throws + async 'error' events) without relying on actual
 * filesystem behaviour, which differs across Linux, macOS, and Windows.
 *
 * This seam is intentionally separate from the `watch` dep on `TailLogDeps`:
 * that dep replaces the entire `watchFn`; this one only replaces the
 * underlying `fs.watch` call *inside* the default `watchFn` so that the
 * FIX-C/D error-handling code is still exercised by the test.
 */
export type FsWatchFn = typeof fsWatch;

let _defaultFsWatch: FsWatchFn = fsWatch;

/**
 * Override the `fs.watch` implementation used by the default `watchFn`.
 * Call with `undefined` to restore the real `fs.watch`.
 * Intended for unit tests only.
 */
export function _setFsWatch(fn: FsWatchFn | undefined): void {
  _defaultFsWatch = fn ?? fsWatch;
}

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
  on(event: 'close', cb: () => void): this;
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
      // Track the byte cursor so each change event reads only newly-appended
      // bytes (createReadStream reads bytes present at open time only and
      // never sees future appends — fs.watch fires on each write).
      let pos = startPos;
      const closeListeners: Array<() => void> = [];
      // FIX C: guard against overlapping reads from a burst of change events.
      // While a read stream is active, skip starting a new one; when the stream
      // ends, do one more read if a change arrived while we were busy.
      let reading = false;
      let pending = false;

      const doRead = (): void => {
        if (reading) {
          pending = true;
          return;
        }
        reading = true;
        pending = false;
        const stream = createReadStream(path, { start: pos });
        stream.on('data', (chunk) => {
          const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
          pos += buf.length;
          onData(buf);
        });
        stream.on('end', () => {
          stream.destroy();
          reading = false;
          // If another change arrived while we were reading, do one more pass.
          if (pending) doRead();
        });
        stream.on('error', () => {
          // Swallow read errors (e.g. transient ENOENT during rotation).
          reading = false;
          if (pending) doRead();
        });
      };

      // FIX D: guard against fs.watch errors on missing or inaccessible files.
      // On Linux, fs.watch on a missing path can THROW synchronously; on other
      // platforms it may instead emit an async 'error' event. We handle both:
      //   • try/catch swallows a synchronous throw (FIX-D path A).
      //   • on('error') swallows the async event    (FIX-D path B).
      // In either case the follow promise stays pending until close() is called.
      // FIX D: guard against fs.watch errors on missing or inaccessible files.
      // On Linux, fs.watch on a missing path can THROW synchronously; on other
      // platforms it may instead emit an async 'error' event. We handle both:
      //   • try/catch swallows a synchronous throw (FIX-D path A).
      //   • on('error') swallows the async event    (FIX-D path B).
      // In either case the follow promise stays pending until close() is called.
      let watcher: ReturnType<typeof fsWatch>;
      try {
        watcher = _defaultFsWatch(path, doRead);
      } catch {
        // Synchronous throw (e.g. ENOENT on Linux) — return a no-op watcher so
        // the caller still gets a valid handle whose close() fires 'close'.
        return {
          on(event, cb) {
            if (event === 'close') closeListeners.push(cb as () => void);
            return this;
          },
          close() {
            for (const fn of closeListeners) fn();
          },
        };
      }
      watcher.on('error', (_err) => {
        // Swallow async watch errors (e.g. ENOENT on missing file in follow mode).
        // The follow promise stays pending until close() is called.
      });

      return {
        on(event, cb) {
          if (event === 'close') closeListeners.push(cb as () => void);
          return this;
        },
        close() {
          watcher.close();
          for (const fn of closeListeners) fn();
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

/** Stream newly-appended bytes from `logPath` starting at `startPos`.
 * The returned promise stays PENDING while following and settles only when
 * the watcher emits a `'close'` event (or its `close()` method is called).
 * In production the caller (or a SIGINT/SIGTERM handler) calls `watcher.close()`
 * to tear down; in tests the fake watcher fires the `'close'` listener. */
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

    // Resolve only when the watcher signals it has been closed — this keeps
    // the promise (and the CLI process) alive while --follow is active.
    watcher.on('close', resolve);
  });
}
