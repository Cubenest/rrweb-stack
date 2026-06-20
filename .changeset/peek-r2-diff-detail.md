---
"@peekdev/mcp": minor
"@peekdev/extension": minor
---

Make refs identity-stable, add `get_element_detail`, and add `observe` to the act path.

Refs are now **identity-stable**: an element keeps the same `ref` (e.g. `e5`)
across `get_page_view` snapshots, and a newly-appeared element gets a fresh
higher `e{N}`. Identity is keyed by a MAIN-world `WeakMap<Element, ref>` (a JS
global, auto-GC'd on detach) plus a monotonic counter — never a DOM attribute,
so rrweb still never records it. The agent can therefore reason about "the same
button" turn-over-turn instead of re-resolving from scratch.

`get_element_detail(ref)` (NEW): an on-demand, lossless, masked drill-in for a
single element resolved by `ref` — role, full accessible name, every `aria-*`
attribute, state (disabled/checked/expanded/selected/required/readonly), value,
type, href, position, nearby heading + landmark, and direct interactive children
with their own refs. Use it to disambiguate or inspect just the one element you
need rather than re-snapshotting the page. It is non-mutating, available at
per-origin Level 1+, and audit-logged via the `level-1-read` approver. It NEVER
reads `outerHTML`/`innerHTML` (that would bypass masking and return raw input
values).

`observe: true` on a mutating `execute_action` returns `details.viewDelta` — a
masked diff of what changed (added / removed / changed refs) — so the agent can
verify its action in one round-trip instead of a second `get_page_view`. A
navigating action returns a `{ navigated: true }` "refs expired" marker (the
registry is wiped by the new page), prompting a fresh snapshot.

Masking is unchanged and consistent with peek's recorder: password/email/tel and
PII-autofill values (card, address, birthday, name, organization, etc.) are
masked in-page to `•••`, structured PII in accessible names and remaining values
is scrubbed by the service worker before anything reaches the agent, and any
field marked `.rr-mask` / `data-private` / `data-dd-privacy` / `data-peek-mask`
is dropped. As with the recorder, **free-text field values (e.g. a search box or
a textarea) may still be returned** — annotate sensitive free-text fields with a
mask class to exclude them. This does not claim no PII reaches the agent.
