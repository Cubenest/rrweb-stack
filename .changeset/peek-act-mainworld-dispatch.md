---
"@peekdev/extension": patch
---

fix: self-contain the MAIN-world injected functions so `execute_action` can drive the DOM

`dispatchAction` and `resolveTarget` are passed by reference to
`chrome.scripting.executeScript({ world: 'MAIN', func })`, which serializes only
each function's own source into the page. Both called a module-scope
`resolveElement` helper that did not travel with the serialized function, so
every click / type / scroll-into-view action threw `ReferenceError` in the page
and silently failed with `"no result from MAIN-world dispatch"` — the write-path
never actually drove the browser. Inlined `resolveElement` as a nested function
inside both injected functions (each now references only its params + page
globals) and added a serialization regression test that reconstructs the
function from `.toString()` in a helper-free scope. Verified live: the first
successful end-to-end `execute_action`.
