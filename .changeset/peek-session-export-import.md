---
"@peekdev/cli": minor
---

Local file-based session export/import: `peek sessions export <id> --format bundle`
writes a portable, self-contained `*.peekbundle` (a gzipped tar of the rrweb event
stream + console/network rows + metadata, with a SHA-256 integrity manifest and an
honest masking caveat), and a new `peek sessions import <file>` reconstructs the
session in the local store (mint-new-id by default; `--keep-id`/`--force` to
preserve). No cloud, no account — an explicit, local-first file handoff.
