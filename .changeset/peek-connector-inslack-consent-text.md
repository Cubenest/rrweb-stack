---
"@peekdev/mcp": patch
---

Make the per-action consent prompt human-readable. `buildElicitMessage` now
produces a masked, verb-specific sentence (e.g. *peek wants to Type "m•••m" into
`#email` on your live browser. Approve?*) instead of a generic
`run "<type>"` string. Literal values (`type` text, `request_user_input` prompt)
are masked to the first and last character so no secret is rendered in the
connecting client's chat history. No MCP-contract change — the tool input schema
is unchanged; only the elicitation message text differs.
