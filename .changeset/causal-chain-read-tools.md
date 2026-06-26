---
"@peekdev/mcp": minor
---

peek: causal-chain enrichment of the forensic read tools

`get_user_action_before_error` now returns a pre-assembled causal chain — a single time-ordered `timeline` (user action → DOM mutation → network/console error) plus grouped `domMutations`/`networkErrors`, the seed `error`, and a deterministic `narrative` — instead of just the action list. A new `windowMs` parameter bounds the correlated context. `query_dom_history` gains a selector-free window mode (`ts` + `windowMs`) returning DOM changes in a time window with `target` hints. All additive; no LLM, no new egress.
