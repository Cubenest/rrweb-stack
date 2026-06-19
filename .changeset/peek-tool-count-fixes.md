---
"@peekdev/cli": patch
"@peekdev/mcp": patch
---

docs: correct the peek MCP tool count + permission model (the surface grew from
10 to 14 tools).

The READMEs, the Claude Code skill (`peek-skill.md`), and the `server.ts` header
comment all still described the original Level-1 read surface ("10 tools",
"writes are Phase 3d — not registered here"). The server now registers 14 tools:
the 8 read tools, the act tools (`execute_action`, `request_authorization`), the
Level-2 Suggest tools (`suggest_element`, `clear_highlight`), and the Level-4
control tools (`set_intent`, `request_user_input`).

Also fixes the skill's permission model, which described a wrong 6-level (0–5)
scheme with the wrong default and the wrong storage location. It now matches
ADR-0010: five levels (0 Off · 1 Read-only default · 2 Suggest · 3
Act-with-confirm · 4 YOLO), stored in `chrome.storage.sync`, with the
destructive blocklist as a cross-level override (not a "Level 5"). Docs/comment
only; no code change.
