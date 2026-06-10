---
"@peekdev/mcp": patch
---

Improve generated Playwright repros: coalesce duplicate navigations and double-fired clicks, collapse typing bursts to the final value, element-type-aware actions (checkbox→check/uncheck, skip hidden/file inputs), and assert the final URL (`toHaveURL`). Does NOT yet recover Enter-to-submit / search intent (tracked separately).
