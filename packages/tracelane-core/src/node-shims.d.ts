// Minimal ambient declarations for the Node built-ins this package uses.
//
// @tracelane/core is mostly platform-light (its page-scripts run in-browser),
// but `load-rrweb-bundle.ts` runs Node-side in the adapter's worker: it reads
// the built in-page rrweb source off disk. Like @tracelane/report we hand-roll
// the exact surface used here rather than depend on `@types/node`, to stay
// consistent with the substrate "platform-light, no @types/node" convention.
// Widen deliberately if more Node API is needed.

declare module 'node:fs' {
  /** Read a file synchronously and return its UTF-8 decoded contents. */
  export function readFileSync(path: string | URL, encoding: 'utf8'): string;
  /** Synchronously test whether `path` exists. */
  export function existsSync(path: string): boolean;
}

declare module 'node:path' {
  /** Join path segments with the platform separator and normalize. */
  export function join(...segments: string[]): string;
  /** Return the directory portion of a path. */
  export function dirname(path: string): string;
}

declare module 'node:url' {
  /** Convert a `file:` URL (string or URL) to a platform path string. */
  export function fileURLToPath(url: string | URL): string;
}
