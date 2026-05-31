---
'@tracelane/report': patch
---

Polish pass on the time-synced panels: `role="status"` + `aria-live="polite"` on the pending placeholder divs so screen readers are notified when console/network rows start streaming in. `window.__player` renamed to `window.__tracelanePlayer` for namespace hygiene before any embed scenario. Added a `// TODO(perf)` marker in `tickPanels` noting that DOM re-queries on every tick are fine at current demo scale but should be cached once Actions/Timeline panels ship.
