---
"@peekdev/mcp": patch
---

peek: delegated consent via MCP elicitation for the `execute_action` tool

When an MCP client advertises the `elicitation.form` capability (connectors that
relay consent to a human over chat, not the browser confirm banner), the peek
MCP server now elicits delegated consent before running `execute_action`:
`dispatchActTool` calls a defensive elicitation helper (capability-probe → race a
120 s timeout → degrade, never throws) and, on a declined/cancelled/timed-out
elicitation, short-circuits to `{ verdict: 'deny', … }` **before** the host bridge
runs the action. Clients that do not advertise elicitation (e.g. Claude Code) are
unaffected — the server proceeds exactly as before. Uniform for `execute_action`;
peek does not classify destructive-vs-safe (the extension gate remains the
backstop). No new egress.
