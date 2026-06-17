---
"@peekdev/extension": patch
---

Show "Connecting…" on a fresh first connect, and "Reconnecting…" only after a
connection has dropped.

The native-host state machine had no distinct "connecting" state and set
`reconnecting` on the very first failed connect, so a fresh start (or a host
that has never registered) showed a misleading "Reconnecting…" in the side
panel before any connection had ever held. The side panel now tracks whether a
connection has ever held (the same `CONNECTION_HELD_MS` window that gates the
reconnect-attempt counter) and labels the pill accordingly: "Connecting…" until
the first hold, "Reconnecting…" afterwards. No state-machine behaviour change;
the "run `peek init`" setup hint still surfaces on a stalled connect.
