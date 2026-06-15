---
"@peekdev/mcp": patch
"@peekdev/extension": patch
---

Windows-hardening (Phase B): three fixes for installing and connecting the peek native host on Windows.

- **Surface `reg.exe` failures instead of swallowing them** (`@peekdev/mcp`). The default registry-write sink ran `reg.exe add … /f` with `stdio: 'ignore'`, so when the HKCU write failed (locked/redirected hive, restricted token, EACCES) its stderr was discarded and the postinstall log showed a useless bare "Command failed". It now pipes stderr and rethrows a message that folds in `reg.exe`'s own stderr plus the exit status, so the per-target error the user sees is actionable.
- **Resolve the home directory via `os.homedir()` in postinstall** (`@peekdev/mcp`). The postinstall path derived `home` from `process.env.HOME ?? process.env.USERPROFILE`, which on Git Bash for Windows picks up a POSIX `$HOME` (`/c/Users/jane`) that diverges from where Chrome/Edge actually read the host manifest. It now uses `os.homedir()` (which returns `%USERPROFILE%` on Windows), matching the `peek` CLI, and drops the empty-string fallback.
- **Make the "run `peek init`" setup hint reachable from a stuck reconnect** (`@peekdev/extension`). When `connectNative` threw because the native host was never registered, the background state machine parked in `reconnecting` and never returned to `disconnected`, so the side panel showed a perpetual "Reconnecting…" pill and the setup hint (previously gated on `disconnected` only) was unreachable. The service worker now tracks consecutive failed reconnect attempts and the side panel surfaces the same "run `peek init`" guidance once the reconnect has been stalling long enough that the host is almost certainly unregistered.
