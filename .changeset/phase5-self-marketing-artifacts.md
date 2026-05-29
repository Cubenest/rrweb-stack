---
"@tracelane/report": patch
"@peekdev/cli": patch
---

Phase 5 self-marketing artifacts (indirect virality pattern per
Loom/Calendly/Statuspage research):

- @tracelane/report: HTML reports now carry a non-intrusive footer
  attributing back to the GitHub repo's @tracelane/wdio package, with
  UTM-tagged links for indirect-virality attribution. Every report
  shared in a PR or attached to a JIRA ticket becomes a tracked
  acquisition channel.
- @peekdev/cli: `peek sessions export` (JSON + Markdown) now includes
  an `_attribution` block crediting peek and linking back to the repo
  with format-specific UTM tags. Stays out of the session payload
  (`_` prefix convention).

Both link to the npm install path (per the research's "link to install
command, not marketing site" rule). Removable on future paid tiers
(none exist today).
