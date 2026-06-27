---
"@peekdev/extension": minor
"@peekdev/mcp": minor
---

peek: richer live page-inspection in `get_element_detail`

`get_element_detail` now returns a curated, masked computed-style bag, the
accessible description (resolved from `aria-describedby` / `aria-description`),
and effective `aria-hidden` / `aria-disabled` inheritance flags — all Level-1
read-tier, DOM-only (no CDP, no eval), and masked (in-page redaction for
`.rr-mask`/`[data-private]` regions plus service-worker-side masking of the
description text and every `url()` in `background-image`). Live console/network
state remains available via the existing `get_session_console_errors` /
`get_session_network_errors` tools. Additive; no schema, permission, or tool
change.
