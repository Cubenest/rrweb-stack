---
"@tracelane/report": patch
"@tracelane/wdio": patch
---

Make the advisory security analyzer an internal implementation detail. `@tracelane/security` is now a private workspace package (never published); `@tracelane/report` vendors its source in at build time, so the published `@tracelane/report` carries the analyzer with no external dependency on it. `@tracelane/wdio` imports the `Suppression` type from `@tracelane/report` and no longer depends on `@tracelane/security`. No behavior change — the advisory security-hygiene panel + Markdown output work exactly as before. This supersedes 0.1.0-alpha.16/17 (report) and 0.1.0-alpha.20 (wdio), which referenced the unpublished `@tracelane/security` and were not installable.
