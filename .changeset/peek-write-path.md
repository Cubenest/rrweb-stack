---
"@peekdev/mcp": minor
"@peekdev/extension": minor
---

Wire the execute_action write-path end-to-end: a LocalSocketHostBridge (MCP process) ↔ HostSocketServer (native host) over ~/.peek/host.sock, a MAIN-world action dispatcher (click/type/navigate/scroll), a side-panel confirm banner, and confirmToken consumption that skips the banner. Level 3 (act-with-confirm) with audit logging. peek is no longer read-only by default — at Level 3 every action prompts the side-panel banner before it runs; off by default per the permission model. Level 4 (YOLO auto), Level 2 highlight, and the remaining actions are queued.
