// Minimal ambient declarations for the Node built-ins this package uses at
// runtime.
//
// @tracelane/playwright runs inside the Playwright worker (Node): it reads the
// bundled in-page rrweb source off disk (via @tracelane/core's loadRrwebBundle)
// and writes the HTML report to `outDir` (via @tracelane/report's writeReport).
// Like @tracelane/report, we hand-roll the exact surface used here rather than
// depend on `@types/node`, to stay consistent with the substrate / core
// "platform-light" convention. Widen deliberately if more Node API is needed.

declare module 'node:fs' {
  /** Read a file synchronously and return its UTF-8 decoded contents. */
  export function readFileSync(path: string | URL, encoding: 'utf8'): string;
  /** Create a directory (and parents when `recursive`). */
  export function mkdirSync(path: string, options?: { recursive?: boolean }): string | undefined;
  /** Write `data` to `path`, replacing the file if it exists. */
  export function writeFileSync(path: string, data: string): void;
  /** Synchronously test whether `path` exists. */
  export function existsSync(path: string): boolean;
  /** Synchronously return file metadata (only `.size` is used here). */
  export function statSync(path: string): { size: number };
}

declare module 'node:path' {
  /** Join path segments with the platform separator and normalize. */
  export function join(...segments: string[]): string;
  /** Return the directory portion of a path. */
  export function dirname(path: string): string;
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
  /** Convert a `file:` URL (string or URL) to a platform path string. */
  export function fileURLToPath(url: string | URL): string;
}
