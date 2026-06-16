// Decide whether this module is the process entry point (`node thisfile`, or an
// npm-generated bin shim) versus merely imported (tests, or another package
// consuming an export). Bin entries guard their `main()` side effect on this so
// an ESM `import` has no side effects.
//
// WHY pathToFileURL (P-Windows): the original guard compared `import.meta.url`
// against the string-concatenated `` `file://${process.argv[1]}` ``. On Windows
// `process.argv[1]` is a backslash path (`C:\…\index.js`), so that concat
// produced the INVALID url `file://C:\…\index.js`, which never equals
// `import.meta.url`'s RFC-8089 form (`file:///C:/…/index.js`). The guard was
// always false → `peek init` (and every command) was a silent no-op on Windows.
// The same concat also failed for paths with spaces/unicode on POSIX because it
// skipped percent-encoding. `pathToFileURL` produces the correct, encoded
// `file:` url on every platform, so the comparison matches.

import { realpathSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

/**
 * True when `metaUrl` (an `import.meta.url`) refers to the same file as
 * `argv1` (`process.argv[1]`) — i.e. this module was run directly. Compares via
 * {@link pathToFileURL} so backslash (Windows) and space/unicode paths resolve
 * to a matching `file:` url. Tries the raw argv path first, then its
 * realpath-resolved form (npm bin shims / symlinks). `realpath` is injectable
 * for tests; a realpath failure resolves to `false` rather than throwing.
 */
export function isDirectInvocation(
  metaUrl: string,
  argv1: string | undefined,
  realpath: (p: string) => string = realpathSync,
): boolean {
  if (argv1 === undefined) return false;
  if (metaUrl === pathToFileURL(argv1).href) return true;
  try {
    return metaUrl === pathToFileURL(realpath(argv1)).href;
  } catch {
    return false;
  }
}
