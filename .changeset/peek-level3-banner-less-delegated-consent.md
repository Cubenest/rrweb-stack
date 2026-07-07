---
"@peekdev/extension": patch
"@peekdev/mcp": patch
---

peek: Level-3 banner-less delegated consent for connectors (SP3b)

When an elicitation-capable connector obtains a human's approval off-device
(SP3a), peek-mcp now attaches `consentDelegated` to the action request, and the
extension service worker skips its Level-3 local banner for non-destructive
actions — dispatching banner-less and recording a distinct `connector-elicit`
approver. Destructive actions still always force the local banner; the
dispatch-time TOCTOU re-check still applies; delegation never escalates below
Level 3; direct clients (e.g. Claude Code) are unaffected. No new egress.
