-- 0001_initial — peek native-host SQLite schema (ADR-0007).
--
-- The native messaging host owns ~/.peek/sessions.db; the extension writes via
-- native messaging and the MCP server + CLI read the same file directly. rrweb
-- event blobs live on disk under ~/.peek/rrweb-events/ (gzipped, one per
-- session); this DB stores session metadata, the chunk index into those blobs,
-- and the extracted console / network / audit rows that the MCP tools query.
--
-- Conventions: UTC ISO-8601 strings for timestamps (text); epoch-millis
-- integers where a monotonic ordering key is wanted (`ts_ms`). All foreign keys
-- reference sessions(id) and cascade on delete so `peek sessions delete` is a
-- single statement.

-- One row per recorded browser session.
CREATE TABLE sessions (
  id              TEXT PRIMARY KEY,            -- e.g. "s_8nQ..."
  created_at      TEXT NOT NULL,               -- UTC ISO-8601 of first event
  updated_at      TEXT NOT NULL,               -- UTC ISO-8601 of last append
  url             TEXT,                        -- initial top-frame URL
  title           TEXT,                        -- initial document title
  origin          TEXT,                        -- scheme://host[:port] of `url`
  user_agent      TEXT,
  -- Path to the gzipped rrweb event blob for this session, relative to
  -- ~/.peek/rrweb-events/ (the native host owns the absolute base).
  events_blob_path TEXT,
  event_count     INTEGER NOT NULL DEFAULT 0,  -- total rrweb events recorded
  bytes           INTEGER NOT NULL DEFAULT 0,  -- on-disk size of the blob
  status          TEXT NOT NULL DEFAULT 'active' -- 'active' | 'finalized'
);

CREATE INDEX idx_sessions_created_at ON sessions (created_at);
CREATE INDEX idx_sessions_origin ON sessions (origin);

-- Index of rrweb event chunks appended over native messaging. The events
-- themselves are persisted to the gzipped blob; a chunk row records the byte
-- range + event range so a reader can seek without parsing the whole blob.
CREATE TABLE events_chunks (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id  TEXT NOT NULL REFERENCES sessions (id) ON DELETE CASCADE,
  seq         INTEGER NOT NULL,                -- 0-based chunk order within session
  start_ts_ms INTEGER NOT NULL,               -- epoch-millis of first event in chunk
  end_ts_ms   INTEGER NOT NULL,               -- epoch-millis of last event in chunk
  event_count INTEGER NOT NULL,
  byte_offset INTEGER NOT NULL,               -- offset into the gzipped blob
  byte_length INTEGER NOT NULL,
  created_at  TEXT NOT NULL,
  UNIQUE (session_id, seq)
);

CREATE INDEX idx_events_chunks_session ON events_chunks (session_id, seq);

-- Console messages extracted from the rrweb console plugin
-- (EventType=6, plugin "rrweb/console@1") for fast MCP queries.
CREATE TABLE console_events (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id  TEXT NOT NULL REFERENCES sessions (id) ON DELETE CASCADE,
  ts_ms       INTEGER NOT NULL,               -- epoch-millis of the log
  level       TEXT NOT NULL,                  -- 'log'|'info'|'warn'|'error'|'debug'|...
  message     TEXT NOT NULL,                  -- joined payload text
  stack       TEXT,                           -- trace, when present
  url         TEXT                            -- page URL at time of log
);

CREATE INDEX idx_console_events_session ON console_events (session_id, ts_ms);
CREATE INDEX idx_console_events_level ON console_events (session_id, level);

-- Network activity captured via CDP (chrome.debugger) / console-error fallback.
CREATE TABLE network_events (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id    TEXT NOT NULL REFERENCES sessions (id) ON DELETE CASCADE,
  ts_ms         INTEGER NOT NULL,             -- epoch-millis of request start
  method        TEXT NOT NULL,                -- GET/POST/...
  url           TEXT NOT NULL,
  status        INTEGER,                      -- HTTP status; NULL if failed/pending
  status_text   TEXT,
  request_id    TEXT,                         -- CDP requestId, for correlation
  resource_type TEXT,                         -- 'xhr'|'fetch'|'document'|...
  duration_ms   INTEGER,                      -- response time, when known
  error_text    TEXT                          -- net error string, when failed
);

CREATE INDEX idx_network_events_session ON network_events (session_id, ts_ms);
CREATE INDEX idx_network_events_status ON network_events (session_id, status);

-- Append-only audit log of every AI-driven act-tool call (ADR-0010 / PRD §H3).
-- Mirrors the JSONL shape written to ~/.peek/audit.log; kept in SQLite too so
-- `peek audit log --since 1h --tool ... --client ...` is an indexed query.
CREATE TABLE audit_log (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  ts           TEXT NOT NULL,                 -- UTC ISO-8601 of the action
  tool         TEXT NOT NULL,                 -- e.g. 'execute_action'
  args_json    TEXT,                          -- JSON of the tool args
  approval_ts  TEXT,                          -- when the user approved
  approver     TEXT,                          -- 'user' | ...
  client       TEXT,                          -- 'claude-code' | 'cursor' | ...
  session_id   TEXT REFERENCES sessions (id) ON DELETE SET NULL,
  result       TEXT                           -- 'ok' | 'error' | ...
);

CREATE INDEX idx_audit_log_ts ON audit_log (ts);
CREATE INDEX idx_audit_log_tool ON audit_log (tool);
CREATE INDEX idx_audit_log_client ON audit_log (client);
