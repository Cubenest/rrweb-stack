---
"@peekdev/cli": patch
---

Phase 4c QA loop #4 — both 🔴 showstoppers from the maintainer's alpha.4 walk:

- **P-16** — `peek init` now writes a tiny shell wrapper at
  `~/.peek/peek-mcp-host.sh` (`.cmd` on Windows) that hardcodes
  `process.execPath` and points the native-host manifest at the wrapper
  instead of the raw `dist/index.js`. Chrome spawns the manifest's `path`
  via the GUI launcher's `$PATH` (not the shell's); on macOS with both a
  legacy `/usr/local/bin/node` (x86_64 v14) and current
  `/opt/homebrew/bin/node` (arm64), the system PATH resolves
  `#!/usr/bin/env node` to the older binary, which dlopen-fails on
  arm64-compiled `better-sqlite3.node` and crashes the host before Chrome
  reads any output. Standard pattern for Node-based native messaging hosts.

- **K.4** — `peek sessions delete <id>` now also removes the per-session
  chunk directory under `~/.peek/rrweb-events/<id>/`. Pre-fix, the DB row
  was dropped (and child rows cascaded via SQLite ON DELETE CASCADE) but
  the gzipped chunks lingered on disk forever. `peek sessions delete
  --all-older-than <dur>` got the same cascade — SELECT-ids inside a
  transaction so the FS cleanup matches whatever the DB actually removed,
  even under concurrent writes.

peek-cli only — no other packages affected. peek-mcp / tracelane-* stay at
alpha.3; peek-extension stays at alpha.2.
