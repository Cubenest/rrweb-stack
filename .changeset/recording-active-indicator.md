---
"@peekdev/extension": patch
---

Adds a visible recording-active indicator: an always-on toolbar badge shows when peek is capturing, plus a default-on in-page glow rendered inside a closed shadow root (excluded from peek's own rrweb capture). Recording state is driven by the service worker per tab. A "Show recording border" toggle in the side panel hides the in-page glow while the badge stays visible.
