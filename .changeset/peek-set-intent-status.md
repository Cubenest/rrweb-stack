---
"@peekdev/mcp": minor
---

peek: set_intent accepts an optional status

The set_intent tool now takes an optional status: 'done' | 'failed'. Pass it
at the end of an assisted-apply loop to show a clear terminal banner on the
control shield — green for done, red for failed. Omitting status keeps the
previous behavior (a plain status label).
