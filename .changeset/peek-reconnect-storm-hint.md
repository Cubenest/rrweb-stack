---
"@peekdev/extension": patch
---

Fix the native-host "run `peek init`" setup hint never appearing for an
unregistered host.

An unregistered native host on Chrome does not throw synchronously from
`connectNative` — it returns a port that immediately fires `onDisconnect`
("host not found"), a disconnect-storm. The reconnect-attempt counter was reset
the instant a port handle appeared, so the stall threshold was never reached and
the side panel showed a perpetual "Reconnecting…" with no guidance. The reset is
now deferred behind a `CONNECTION_HELD_MS` window — only a connection that
actually holds clears the counter — so a storm accumulates attempts and surfaces
the setup hint. Adds a Playwright e2e covering the unregistered-host scenario.
