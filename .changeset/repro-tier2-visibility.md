---
"@peekdev/mcp": patch
---

get_session_summary now reports `hasReplay`/`eventCount` and warns when a session captured no DOM/replay events (e.g. recorded with Deep capture / chrome.debugger attached, which currently suppresses rrweb capture) — so replay-less sessions are visible instead of silently looking healthy.
