---
"@peekdev/cli": patch
---

Fix `peek sessions list --json` field shape: now emits `console_count` +
`network_count` per row as the original P-18 spec called for. Uses a
single SQL aggregation (correlated subqueries leveraging the existing
`(session_id, ...)` indexes on `console_events` + `network_events`) — no
N+1 queries on the list path. Definitions match `getSessionCounts`
exactly (console errors = level='error'; network errors = status >= 400
OR error_text non-null) so JSON list + `peek sessions show <id>` agree.

Alpha.7 shipped the wrong shape (was emitting `bytes` + `status` instead
of the spec'd counts). Both fields are still emitted alongside the
counts since they're already in the row and useful for triage — strict
spec required the counts, didn't prohibit the extras.
