---
"@peekdev/cli": patch
"@peekdev/mcp": patch
---

Fix two Windows-only failures found in the 2026-06-15 Windows-compatibility audit.

**`peek` CLI was a silent no-op on Windows (critical).** The bin entry guard
compared `import.meta.url` against the string-concatenated `` `file://${process.argv[1]}` ``.
On Windows `process.argv[1]` is a backslash path (`C:\…\index.js`), so the
concat produced the invalid url `file://C:\…\index.js`, which never equals
`import.meta.url`'s RFC-8089 form (`file:///C:/…/index.js`). `invokedDirectly`
was therefore always `false` and `main()` never ran — so `peek init`, `peek
status`, every command did nothing on Windows (and, with the native host never
registered, the extension could never connect). The guard now uses
`pathToFileURL` (new `isDirectInvocation` helper), which also fixes the same
mismatch for paths containing spaces/unicode on POSIX. The identical guard in
`@peekdev/mcp`'s `postinstall.ts` is fixed the same way.

**better-sqlite3 load failure crashed the native host with no message (high).**
`db/open.ts` imported `better-sqlite3` at top-level module scope, so its native
`.node` binding loaded at module-evaluation time. A missing / ABI-mismatched
(Node < 22) / antivirus-locked prebuild threw before `main()` could catch it —
and stock Windows has no compile-from-source fallback — so the host process died
and the browser saw a silently-closed stdio pipe. The import is now type-only
and the constructor is loaded lazily (`loadBetterSqlite3`), deferring the load
into `openDb()` and wrapping failures in an actionable error that names the
Node 22+ requirement, the platform/arch, and the likely cause.
