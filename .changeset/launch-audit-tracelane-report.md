---
"@tracelane/report": minor
---

Launch-readiness fixes to the generated HTML report:

- **Accurate network classification.** Cross-origin sub-resources (analytics,
  CDN, fonts) that report `responseStatus: 0` per the Resource Timing spec are
  no longer misclassified as failed requests. A `status === 0` row is treated
  as a failure only when it came from a true error path (a fetch/XHR wrapper or
  CDP), not a PerformanceObserver timing entry — eliminating phantom failures in
  the Network panel and the AI-handoff Markdown.
- **Merge network sources.** `extractNetwork` now unions the in-page plugin and
  the CDP `[tracelane.net]` rows (preferring CDP's authoritative status) instead
  of first-non-empty-wins, and `[tracelane.net]` lines are filtered out of the
  Console panel so a failure isn't double-rendered.
- **Removable footer.** The attribution footer can now be suppressed (gated by a
  `footer` flag threaded from `@tracelane/wdio`'s `report.footer` option).
- **Accessibility.** Tabs expose `aria-selected`/`aria-controls`/`aria-labelledby`
  (updated on switch), and the time-synced Console/Network rows are keyboard
  reachable (`tabindex`/`role=button`/`aria-label` + Enter/Space seek).
- **Polish.** "soon" pills on the not-yet-implemented Actions/Timeline tabs; the
  masthead no longer renders a stray separator slash after the logo.
