---
"@peekdev/mcp": minor
---

peek: session-to-repro hardening

`generate_playwright_repro` now emits Playwright semantic locators (`getByTestId` / `getByRole` / `getByPlaceholder` / `getByText`, each uniqueness-checked, with a CSS `page.locator(...)` fallback) instead of bare CSS selectors, and accepts an optional `errorId` that seeds a console-error-absence regression assertion (`page.on('console', …)` + `expect(consoleErrors.join('\n')).not.toContain(<captured message>)`) — so the repro fails while the bug is present and passes once fixed. The shared CSS selector heuristic also prefers `[aria-label]`/`[placeholder]` over `:nth-of-type`, improving the other read tools too. Additive; deterministic; no new egress.
