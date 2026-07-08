---
"@peekdev/cli": minor
---

peek: `peek connect` — a supervised daemon for running connectors locally

New `peek connect` command: register connectors (add/list/remove) in
~/.peek/connect/connectors.json, and start/stop/status/logs a detached
supervisor that spawns, monitors, and restarts-with-backoff each connector as a
subprocess (single-instance lock, per-connector logs). Connectors are launched
by a descriptor-default command (e.g. peek-connector-slack) or a per-entry
override; peek-cli depends on no connector package. Autostart and a dashboard
are future work.
