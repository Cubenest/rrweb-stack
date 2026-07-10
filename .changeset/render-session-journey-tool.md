---
"@peekdev/mcp": minor
---

peek-mcp: add `render_session_journey` tool for connector canvas rendering

New read tool `render_session_journey({ sessionId, errorId? })` returns the full `CausalChain` (timeline, narrative, error, actions, DOM mutations, network errors) for a session — the same data path as `get_user_action_before_error`, under a dedicated tool name so a connector can intercept only journey results for rich rendering (e.g. a Slack canvas). When `errorId` is omitted, the session's latest console error is selected automatically. Returns a clear text message when the session has no console errors.
