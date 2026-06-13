---
"@peekdev/extension": patch
"@peekdev/mcp": patch
---

feat: implement the Level-2 "Suggest" tier — MCP-driven DOM highlight overlay

peek-mcp:
- `suggest_element` (selector, optional label) — draws a non-destructive highlight overlay on an element in the live browser, to point something out without changing the page. Available at per-origin permission Level 2 (Suggest) and above.
- `clear_highlight` — removes the active overlay. Idempotent.
- New `highlight` / `clear_highlight` action schemas; new honest `level-2-suggest` audit approver.

Extension:
- Self-contained MAIN-world `applyHighlight` / `clearHighlight` overlay functions (fixed-position ring + optional label badge, re-anchored on scroll/resize, replace-on-reapply, persists until cleared).
- The SW auto-allows highlight/clear_highlight at Level 2+ via a dedicated non-mutating path — no destructive check, no confirm banner, no token. Levels 0/1 deny.

This activates the previously-reserved Level-2 "Suggest-only" tier.
