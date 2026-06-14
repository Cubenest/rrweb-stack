---
'@peekdev/extension': patch
'@peekdev/mcp': patch
---

Add the input handoff (request_user_input): while the Level-4 control shield is
up, the agent can pause and hand the keyboard back to the user for one editable,
non-destructive field (or a free-text prompt), then resume. The returned value
is opt-in (readBack) and never for password/OTP/cc fields; rrweb forwarding is
suspended for the tab during the handoff (incremental channel; the FullSnapshot
residual is documented). Approver is `user`; audit records prompt + selector only.
