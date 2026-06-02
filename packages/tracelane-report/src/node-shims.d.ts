// Minimal ambient declarations for the handful of Node built-ins this package
// uses at build time.
//
// @tracelane/report is a Node-side build tool: it reads the rrweb-player and
// fflate assets off disk and emits an HTML string. Unlike @tracelane/core
// (whose page-scripts run in-browser and can defensively no-op `process`
// reads), there is no browser fallback for reading a file from node_modules —
// so this package legitimately needs `node:fs` + `node:module`.
//
// We hand-roll these declarations rather than depend on `@types/node` to stay
// consistent with the substrate / core "platform-light, no @types/node"
// convention (established in sub-phase 2a). Only the exact surface used here is
// declared; widen it deliberately if more Node API is needed.

/**
 * Minimal `Buffer`-like surface used to base64-encode binary asset reads
 * (the variable woff2 files inlined into the report — Phase 6). We declare
 * only the `.toString(encoding)` method we actually call.
 */
interface BinaryBuffer {
  toString(encoding: 'base64'): string;
}

declare module 'node:fs' {
  /** Read a file synchronously and return its UTF-8 decoded contents. */
  export function readFileSync(path: string | URL, encoding: 'utf8'): string;
  /** Read a file synchronously without an encoding — returns a Buffer-like
   *  object that supports `.toString('base64')`. Used for woff2 fonts. */
  export function readFileSync(path: string | URL): BinaryBuffer;
  /** Synchronously test whether `path` exists (report-writer.ts). */
  export function existsSync(path: string): boolean;
  /** Create a directory (and parents when `recursive`) — report-writer.ts. */
  export function mkdirSync(path: string, options?: { recursive?: boolean }): string | undefined;
  /** Write `data` to `path`, replacing the file if it exists — report-writer.ts. */
  export function writeFileSync(path: string, data: string): void;
}

declare module 'node:path' {
  /** Join path segments with the platform separator and normalize. */
  export function join(...segments: string[]): string;
}

declare module 'node:module' {
  /** A CommonJS-style require, including its `resolve`. */
  interface NodeRequire {
    (id: string): unknown;
    resolve(id: string): string;
  }
  /** Build a `require` rooted at `filename` (typically `import.meta.url`). */
  export function createRequire(filename: string | URL): NodeRequire;
}

declare module 'node:url' {
  /** Convert a file path to a `file:` URL (for safe relative resolution). */
  export function pathToFileURL(path: string): URL;
  /** Convert a `file:` URL back to a platform path string. */
  export function fileURLToPath(url: string | URL): string;
}
