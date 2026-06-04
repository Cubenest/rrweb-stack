---
"@tracelane/core": patch
---

fix(network): preserve the real HTTP method on failed responses

`Network.responseReceived` derived the method from `response.requestHeaders`,
which has no `:method` pseudo-header over HTTP/1.1 (the common case for dev/CI
servers) and fell back to `GET`. A failed `POST`/`PUT`/`DELETE` therefore showed
up as `GET` in the report's failed-network panel.

The fix prefers the method already recorded at `Network.requestWillBeSent` (the
same `inflight` correlation map the `loadingFailed` path uses), falling back to
`methodOf(requestHeaders)` only when the request wasn't tracked. No-response
failures and the `:method`/HTTP-2 path are unchanged.
