-- 0002_network_bodies — persist Deep capture masked bodies (ADR-0010, PRD §A.8).
--
-- The extension already masks request/response bodies via `maskNetMessage` in
-- the ISOLATED-world relay (packages/peek-extension/src/relay/mask.ts) BEFORE
-- forwarding them on `network.append`. Without these columns the native host
-- silently drops the masked bodies on the floor — the user's yellow-banner
-- consent for Deep capture yields no persisted body data, defeating the
-- whole reason `webRequest` is insufficient under MV3 (PRD §A.9).
--
-- Columns are TEXT (the relay produces strings via `redactBody`) and nullable
-- — Basic capture, request-only records, and error records leave them NULL.
-- SQLite's ALTER TABLE ADD COLUMN is non-destructive: existing rows get NULL
-- for the new columns, fresh DBs land with them from the start.
ALTER TABLE network_events ADD COLUMN request_body_redacted TEXT;
ALTER TABLE network_events ADD COLUMN response_body_redacted TEXT;
