---
"@peekdev/mcp": minor
"@peekdev/cli": minor
---

peek: tamper-evident (hash-chained) audit log + `peek audit verify`

The local action audit log (`~/.peek/audit.log`) is now hash-chained — each
entry carries a `seq` counter and a `prevHash` field (SHA-256 of the previous
line), serialized under a file lock, with a small `audit.head.json` sidecar
that records the tail hash for truncation detection. The new `peek audit
verify` command recomputes the chain and reports whether it is intact, or
pinpoints the first broken line.

The audit log is **tamper-evident, not tamper-proof** — it detects accidental
corruption, truncation, reordering, and edits, but does not stop a determined
local attacker who recomputes the whole chain. There are no keys, no external
anchor, and no egress.
