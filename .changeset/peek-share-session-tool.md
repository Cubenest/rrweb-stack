---
'@peekdev/mcp': minor
---

Add `share_session` MCP tool — consent-gated session bundle export.

`share_session(sessionId, surface?)` elicits an explicit egress consent card
(naming what is exported and where) before producing a portable `.peekbundle`
temp file from a recorded session. On deny → `{ ok: false, result: 'denied' }`,
no file written. On approve → `{ ok: true, bundlePath, filename, sizeBytes, caveat }`.
The bundle contains the masked session recording (DOM + console/network events).
Every approved export is recorded to `~/.peek/audit.log` as `tool: share_session`
(session ID + surface; bundle bytes are never written to the audit log).
Designed for connector-driven upload flows (e.g. Slack `@peek share this session`);
the connector is responsible for uploading and deleting the temp file.
