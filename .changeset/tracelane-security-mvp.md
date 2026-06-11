---
"@tracelane/security": minor
"@tracelane/core": patch
"@tracelane/report": patch
"@tracelane/wdio": patch
---

Add an advisory, low-false-positive security-hygiene layer. A new `@tracelane/security` analyzer surfaces missing security headers, mixed content, insecure cookies, and reverse-tabnabbing as a collapsed "Security hygiene (advisory)" panel in the report and in the Copy-as-Markdown-for-AI output. On by default; disable with `security: false`; suppress findings via `tracelane.security.suppress.json`. Advisory only — not a security audit/scan. Capture is privacy-safe (security-header presence + cookie flags, never values).
