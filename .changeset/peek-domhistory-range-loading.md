---
"@peekdev/mcp": minor
---

peek: faster DOM reconstruction on long sessions

`get_dom_snapshot` now loads only the event chunks it needs — from the nearest
full snapshot at or before the requested timestamp through that timestamp — using
the existing per-chunk time index, instead of decompressing the entire session
blob. On a long recording this turns an O(n)-decompress into reading a handful of
chunks. Output is byte-identical. `selectorFor` is now memoized per snapshot
index, speeding selector-based `query_dom_history` lookups. No schema change;
falls back to the full load when the chunk index is unavailable.
