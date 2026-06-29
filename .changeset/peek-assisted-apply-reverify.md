---
"@peekdev/mcp": patch
---

peek: guide agents to re-verify each step of the assisted-apply loop

The MCP server instructions and the execute_action / set_intent tool descriptions
now spell out the "apply and re-verify" convention: after a mutating action, the
agent re-reads the target (get_element_detail for the value, get_page_view for a
validation error) before advancing the status banner, and stops and reports if a
step didn't take rather than retrying blindly. Password/email/PII values stay
masked, so those are verified by the absence of an error. Guidance only — no new
tool, permission, or behavior change.
