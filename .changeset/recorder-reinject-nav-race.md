---
"@tracelane/core": patch
---

Make DOM capture resilient to navigation timing. On real (latency-bearing) cross-document navigations, the recorder's page-side re-injection could race the in-flight navigation, throw "Execution context was destroyed", and be silently swallowed — losing all rrweb DOM capture (FullSnapshot + mutations) on the new page while CDP-derived data still landed. `reinject` now retries past transient navigation-race errors (and `drain` skips a cycle instead of throwing), so recording reliably (re)starts on the navigated page. This restores replay + DOM-derived signals (e.g. the advisory mixed-content / reverse-tabnabbing security checks) on real sites.
