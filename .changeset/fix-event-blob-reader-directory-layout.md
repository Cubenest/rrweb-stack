---
"@peekdev/mcp": patch
---

Fix `loadSessionEvents` so `get_dom_snapshot`, `get_user_action_before_error`,
`query_dom_history`, and `generate_playwright_repro` actually load events from
the on-disk layout the native host writes.

The writer stores one gzipped chunk per `session.append` batch at
`<peek-home>/rrweb-events/<sessionId>/<seq>.json.gz` and writes the per-session
directory into `sessions.events_blob_path`. The reader had two problems on that
layout:

1. It called `readFileSync` on `events_blob_path`, which is a directory — node
   threw `EISDIR`, the catch wrapped it as `SessionEventsError("corrupt or
   truncated recording")`, and the event-walker tools surfaced that as
   "no FullSnapshot / DOM can't be reconstructed" — even though the
   FullSnapshot was sitting in `0.json.gz` the whole time.
2. The writer prepended an extra `rrweb-events/` segment to the stored path,
   which the reader's base directory already included, producing a path that
   doesn't exist.

`loadSessionEvents` now detects the directory layout, walks
`<seq>.json.gz` files in numeric seq order, decompresses each, and concatenates
the event arrays. Single-file blobs (older rows / tests) still work.
`resolveBlobPath` strips a leading `rrweb-events/` segment when present so
existing user data written before the writer fix still loads.
