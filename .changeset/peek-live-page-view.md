---
"@peekdev/mcp": minor
"@peekdev/extension": minor
---

Add `get_page_view`: a live, masked, ref-tagged page snapshot for the act path.

The agent can now perceive the live page as a compact list of interactive/labeled
elements — each with a stable `ref` (e.g. `e5`) — and target a `ref` in
`execute_action` / `request_authorization` (click/type/scroll/enter/dblclick)
instead of authoring a CSS selector from `get_dom_snapshot`'s HTML. That is far
fewer tokens per perception (an accessibility-style list vs ~24KB of HTML) and
deterministic — no selector guessing or ambiguity.

Details: refs live in a MAIN-world registry that is invisible to rrweb recordings,
expire on navigation, and resolve to a clear `ref expired` error so the agent
re-snapshots. `get_page_view` is non-mutating, available at per-origin Level 1+,
and audit-logged with a new `level-1-read` approver.

Masking: password/email/tel and PII-autofill input values (credit-card, address,
birthday, name, organization, etc.), plus any field under `.rr-mask` /
`data-private` / `data-dd-privacy` / `data-peek-mask`, are dropped in-page; the
service worker then runs `maskTextContent` over accessible names and remaining
values to scrub structured PII (emails, cards, tokens). As with peek's existing
recorder, free-text field values (e.g. a search box or a textarea) may still be
returned — annotate sensitive free-text fields with a mask class to exclude them.

Ref-targeted destructive actions go through the destructive-confirm override (the
matcher resolves the same ref'd element). `ref` or `selector` is required for
targeting verbs, enforced at dispatch (kept optional in the zod schema so each
member stays a plain object usable in the discriminated union). Existing
`selector` targeting is unchanged and backward-compatible.
