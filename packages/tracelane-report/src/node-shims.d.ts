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

declare module 'node:fs' {
  /** Read a file synchronously and return its UTF-8 decoded contents. */
  export function readFileSync(path: string, encoding: 'utf8'): string;
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
