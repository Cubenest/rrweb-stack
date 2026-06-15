---
'@peekdev/mcp': patch
---

Audit completeness: redactActionForAudit now records `scope` for request_user_input
entries, so a page-scope full-takeover is distinguishable from a field/free-text
card in ~/.peek/audit.log. Still never records the returned value (or readBack/
timeoutMs); scope is non-secret.
