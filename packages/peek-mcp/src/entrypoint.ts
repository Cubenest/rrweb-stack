// Decide whether this module is the process entry point (`node thisfile`, or an
// npm-generated bin shim) versus merely imported. Bin / postinstall entries
// guard their side effect on this so an ESM `import` (tests, consumers) is inert.
//
// WHY pathToFileURL (P-Windows): comparing `import.meta.url` against the
// string-concatenated `` `file://${process.argv[1]}` `` produced an INVALID url
// on Windows — `process.argv[1]` is a backslash path (`C:\…\x.js`), so the
// concat yields `file://C:\…\x.js`, which never equals `import.meta.url`'s
// RFC-8089 form (`file:///C:/…/x.js`). It also skipped percent-encoding for
// space/unicode paths on POSIX. pathToFileURL produces the correct encoded
// `file:` url on every platform. (Local copy of @peekdev/cli's helper — kept
// per-package so neither bin's entry guard depends on the other's public API.)

import { realpathSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

/**
 * True when `metaUrl` (`import.meta.url`) refers to the same file as `argv1`
 * (`process.argv[1]`). Compares via {@link pathToFileURL} (Windows-safe, encoded)
 * and falls back to the realpath-resolved argv (bin shims / symlinks). A
 * realpath failure resolves to `false`. `realpath` is injectable for tests.
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
