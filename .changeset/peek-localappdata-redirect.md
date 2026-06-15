---
"@peekdev/mcp": patch
"@peekdev/cli": patch
---

Honor `%LOCALAPPDATA%` when registering the Windows native-messaging host.

`resolveInstallTargets` derived the Windows manifest location as
`homeDir\AppData\Local`, ignoring the real `%LOCALAPPDATA%`. On machines where
`AppData\Local` is redirected away from the user profile — OneDrive
Known-Folder-Move, ADMX folder redirection, roaming/UNC profiles — the manifest
was written to the wrong directory while the HKCU registry value pointed there
too, so Chrome/Edge silently failed to find the native host (the extension
could never connect).

`resolveInstallTargets` now takes an optional `localAppData`, and both callers
(`peek init` and the postinstall registrar) inject `process.env.LOCALAPPDATA`,
falling back to `homeDir\AppData\Local` when it is unset.
