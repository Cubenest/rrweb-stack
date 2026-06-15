---
"@peekdev/cli": patch
"@peekdev/mcp": patch
---

Windows robustness hardening (audit Phase D).

- `peek init`'s atomic config write now retries the final rename on Windows when
  it hits a transient `EBUSY`/`EPERM`/`EACCES` (the target or temp briefly locked
  by an editor or antivirus), with a short backoff, instead of failing the whole
  init on the first lock. POSIX behaviour is unchanged (single attempt; non-lock
  errors like `ENOSPC` still fail fast everywhere).
- The native host now returns a clean error result when persisting a screenshot
  fails (`EACCES` on `~/.peek`, disk full, a Windows lock) instead of throwing —
  which previously skipped the `act.response` and left the MCP tool call to hang
  until it timed out. The multi-MB base64 is never inlined on the failure path.
- The stale-bind retry waits a brief beat before rebinding a Windows named pipe
  (released by the OS a moment after the prior host exits), so the single retry
  is more likely to succeed rather than degrading the action write-path.
