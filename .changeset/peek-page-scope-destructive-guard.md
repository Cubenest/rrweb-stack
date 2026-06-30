---
"@peekdev/extension": minor
---

peek: heads-up before a destructive click during a page-scope handoff

When peek hands the whole page to you (a page-scope handoff for a CAPTCHA, final
review, or submit), the control shield now flashes a brief, non-blocking heads-up
the moment you're about to click a destructive-looking control (delete, pay,
transfer, cancel subscription, …). peek never stops the click — you're the actor
during a handoff — it just makes the moment visible. The cue is rendered inside
the shield's existing overlay (invisible to the recording) and matches the same
destructive terms peek already uses for its own actions.
