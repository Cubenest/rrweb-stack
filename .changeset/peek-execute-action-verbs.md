---
"@peekdev/extension": patch
"@peekdev/mcp": patch
---

feat: implement all remaining execute_action verbs (back/forward/reload/waitFor/screenshot/enter/dblclick) and fix screenshot capture

Extension:
- `back` / `forward` / `reload` — history navigation verbs in the MAIN-world dispatcher
- `waitFor` — MutationObserver + timeout race; waits for a selector to attach or a pure delay
- `screenshot` — CDP `Page.captureScreenshot` via the already-declared `debugger` permission (replaces `captureVisibleTab` which requires `<all_urls>` / an `activeTab` user gesture unavailable in the MCP→native-host→SW call path)
- `enter` — dispatches keydown/keypress/keyup with key=Enter on a selector or the active element; triggers native form submission in most frameworks
- `dblclick` — dispatches a `dblclick` MouseEvent on a resolved selector

peek-mcp:
- Adds `EnterActionSchema` and `DblClickActionSchema` to the Zod `ActionSchema` union so the MCP tool surfaces both verbs to AI clients
- `writeScreenshotFile`: host-socket spills the screenshot `dataUrl` to `~/.peek/screenshots/<requestId>.png` (0600) and returns a path pointer instead of a multi-MB base64 blob in the MCP context
