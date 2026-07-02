---
"@peekdev/cli": minor
---

Add `peek audit bundle` to package the audit log + head into a portable `*.peekaudit` evidence archive (SHA-256 integrity manifest), and `peek audit verify --bundle <file>` to verify a received archive (archive integrity + hash chain). Skill updated for the new `verify_audit_log` tool (17 tools).
