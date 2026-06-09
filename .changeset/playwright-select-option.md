---
"@peekdev/mcp": patch
---

`generate_playwright_repro` now emits `page.selectOption()` for `<select>` inputs instead of `page.fill()`, producing runnable specs for dropdown interactions.
