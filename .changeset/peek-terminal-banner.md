---
"@peekdev/extension": minor
---

peek: terminal success/failure banner on the control shield

When an assisted-apply loop ends with set_intent(status:'done'|'failed'), the
control shield now shows a distinct terminal banner — a green "done" banner
that auto-dismisses after a few seconds, or a red "failed" banner that persists
until you act — so the outcome is legible at the place you're already watching.
The banner renders in the shield's existing closed overlay (invisible to the
recording). No new tool or permission.
