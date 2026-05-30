#!/usr/bin/env bash
# Build peek-cli from the monorepo, seed a fixture sessions.db at
# /tmp/peek-hero-demo/.peek/sessions.db, then run vhs against
# assets/peek-hero.tape to produce assets/peek-hero.gif.
#
# Why a fixture: the real ~/.peek/sessions.db belongs to the maintainer's
# actual browsing history and would leak private data into the recording.
# The fixture is three plausible synthetic sessions (a checkout 404, a
# dashboard console error, and a clean read) with realistic origins +
# timestamps, seeded fresh on every run.
#
# Idempotent: re-running this script always REBUILDS peek-cli (in case the
# CLI has changed) and RESEEDS the sessions.db to its starting state so the
# recording is reproducible byte-by-byte across re-records.
#
# Prereqs:
#   - vhs      (brew install vhs)
#   - sqlite3  (preinstalled on macOS; apt/yum install on Linux)
#   - pnpm     (matches the repo's lockfile)
#   - node     (>= 22 to match @peekdev/cli's engines)
#
# Outputs:
#   assets/peek-hero.gif  — the README hero asset (~1-3 MB target)
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEMO_DIR="/tmp/peek-hero-demo"
PEEK_HOME="$DEMO_DIR/.peek"
DB_PATH="$PEEK_HOME/sessions.db"
CLI_BIN="$REPO_ROOT/packages/peek-cli/dist/index.js"
TAPE="$REPO_ROOT/assets/peek-hero.tape"
GIF_OUT="$REPO_ROOT/assets/peek-hero.gif"

# --- Preflight ----------------------------------------------------------

for cmd in vhs sqlite3 pnpm node; do
  if ! command -v "$cmd" >/dev/null 2>&1; then
    echo "ERROR: '$cmd' is not on PATH. Install it first." >&2
    if [ "$cmd" = "vhs" ]; then echo "  brew install vhs" >&2; fi
    exit 1
  fi
done

NODE_MAJOR=$(node -p "process.versions.node.split('.')[0]")
if [ "$NODE_MAJOR" -lt 22 ]; then
  echo "ERROR: Node 22+ required, found $(node -v)" >&2
  exit 1
fi

# --- Build peek-cli from monorepo ---------------------------------------

echo "[build] pnpm --filter @peekdev/cli build"
(cd "$REPO_ROOT" && pnpm --filter @peekdev/cli build >/dev/null)

if [ ! -f "$CLI_BIN" ]; then
  echo "ERROR: $CLI_BIN not found after build" >&2
  exit 1
fi

# --- Seed the fixture sessions.db ---------------------------------------

echo "[seed] resetting $PEEK_HOME"
rm -rf "$DEMO_DIR"
mkdir -p "$PEEK_HOME"

# Bootstrap the DB by letting peek-cli itself create + migrate it. Running
# `peek sessions list` against an empty $HOME triggers openDb() which:
#   1. Creates the sessions.db file via better-sqlite3
#   2. Runs the @peekdev/mcp migrations (0001_initial, 0002_network_bodies)
#   3. Records each migration in the meta-migrations table
#
# Doing it this way (instead of `sqlite3 < 0001_initial.sql`) keeps the
# migrations bookkeeping consistent — otherwise a later `openDb()` would
# try to re-apply 0001 and throw "table sessions already exists".
echo "[seed] bootstrapping schema via peek-cli (creates DB + applies migrations)"
HOME="$DEMO_DIR" "$CLI_BIN" sessions list >/dev/null 2>&1 || true

if [ ! -f "$DB_PATH" ]; then
  echo "ERROR: peek-cli did not create $DB_PATH" >&2
  exit 1
fi

echo "[seed] inserting 3 demo sessions"

# Seed three plausible sessions.
# Timestamps: today at 14:00, 13:32, 11:05 UTC (recent enough to look "live").
TODAY_ISO=$(date -u +"%Y-%m-%d")
TS_1="${TODAY_ISO}T14:00:00.000Z"
TS_1_END="${TODAY_ISO}T14:02:14.000Z"
TS_2="${TODAY_ISO}T13:32:11.000Z"
TS_2_END="${TODAY_ISO}T13:34:52.000Z"
TS_3="${TODAY_ISO}T11:05:43.000Z"
TS_3_END="${TODAY_ISO}T11:08:11.000Z"

TS_1_MS=$(node -p "Date.parse('${TS_1}')")
TS_2_MS=$(node -p "Date.parse('${TS_2}')")
TS_3_MS=$(node -p "Date.parse('${TS_3}')")

sqlite3 "$DB_PATH" <<SQL
INSERT INTO sessions (id, created_at, updated_at, url, title, origin, user_agent, events_blob_path, event_count, bytes, status) VALUES
  ('s_demo_checkout',   '${TS_1}', '${TS_1_END}', 'https://shop.example.com/checkout', 'Checkout — example shop',  'https://shop.example.com',  'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) Chrome/124.0',    's_demo_checkout/0.json.gz',   2418, 184320, 'finalized'),
  ('s_demo_dashboard',  '${TS_2}', '${TS_2_END}', 'http://localhost:3000/dashboard',  'My App — dashboard',        'http://localhost:3000',     'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) Chrome/124.0',    's_demo_dashboard/0.json.gz',  1842, 142336, 'finalized'),
  ('s_demo_docsread',   '${TS_3}', '${TS_3_END}', 'https://github.com/Cubenest/rrweb-stack', 'Cubenest/rrweb-stack', 'https://github.com',      'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) Chrome/124.0',    's_demo_docsread/0.json.gz',    611,  45056, 'finalized');

INSERT INTO console_events (session_id, ts_ms, level, message, stack, url) VALUES
  ('s_demo_checkout', $((TS_1_MS + 8200)),  'warn',  'Stripe.js loaded twice on this page', NULL, 'https://shop.example.com/checkout'),
  ('s_demo_checkout', $((TS_1_MS + 12100)), 'error', 'Failed to load resource: the server responded with a status of 404 (Not Found)', NULL, 'https://shop.example.com/checkout'),
  ('s_demo_dashboard', $((TS_2_MS + 4300)), 'error', 'Cannot read properties of undefined (reading "id")', 'TypeError: Cannot read properties of undefined (reading "id")\\n    at DashboardCard (src/components/DashboardCard.tsx:34:14)\\n    at renderWithHooks (react-dom.js:1234:18)', 'http://localhost:3000/dashboard'),
  ('s_demo_dashboard', $((TS_2_MS + 4350)), 'error', 'The above error occurred in the <DashboardCard> component', NULL, 'http://localhost:3000/dashboard');

INSERT INTO network_events (session_id, ts_ms, method, url, status, status_text, request_id, resource_type, duration_ms, error_text) VALUES
  ('s_demo_checkout', $((TS_1_MS + 12000)), 'POST', 'https://shop.example.com/api/checkout/confirm', 404, 'Not Found',    'r_1001', 'fetch', 187,  NULL),
  ('s_demo_checkout', $((TS_1_MS + 14500)), 'POST', 'https://shop.example.com/api/cart/restore',     500, 'Server Error', 'r_1002', 'fetch', 412,  NULL),
  ('s_demo_dashboard', $((TS_2_MS + 6800)), 'GET',  'http://localhost:3000/api/user/preferences',    500, 'Server Error', 'r_2001', 'xhr',   85,   NULL);
SQL

if ! sqlite3 "$DB_PATH" "SELECT COUNT(*) FROM sessions" | grep -q '^3$'; then
  echo "ERROR: seed failed — expected 3 sessions in $DB_PATH" >&2
  exit 1
fi
echo "[seed] OK — 3 sessions + 4 console events + 3 network events"

# --- Stage a PATH that resolves `peek` to the built dist ----------------

# vhs invokes commands via the user's shell. The .tape says `peek sessions
# list`; we make `peek` resolve to the monorepo build by dropping a symlink
# into a /tmp PATH dir that prefixes everything else.
PATH_DIR="$DEMO_DIR/bin"
mkdir -p "$PATH_DIR"
ln -sf "$CLI_BIN" "$PATH_DIR/peek"
chmod +x "$CLI_BIN"

# --- Record -------------------------------------------------------------

echo "[record] running vhs against $TAPE (cwd=$DEMO_DIR, HOME=$DEMO_DIR)"

# HOME=$DEMO_DIR so peek-cli's peekHomeDir() resolves to $DEMO_DIR/.peek/
# (where we seeded the fixture); PATH gets our bin/ dir first so `peek`
# resolves to the symlinked monorepo build.
(cd "$DEMO_DIR" && HOME="$DEMO_DIR" PATH="$PATH_DIR:$PATH" vhs "$TAPE")

if [ ! -f "$DEMO_DIR/peek-hero.gif" ]; then
  echo "ERROR: $DEMO_DIR/peek-hero.gif was not produced by vhs" >&2
  exit 1
fi

mv "$DEMO_DIR/peek-hero.gif" "$GIF_OUT"

# --- Verify -------------------------------------------------------------

if [ ! -f "$GIF_OUT" ]; then
  echo "ERROR: $GIF_OUT (post-move) is missing" >&2
  exit 1
fi

GIF_SIZE_BYTES=$(stat -f%z "$GIF_OUT" 2>/dev/null || stat -c%s "$GIF_OUT")
GIF_SIZE_HUMAN=$(ls -lh "$GIF_OUT" | awk '{print $5}')
echo "[done] $GIF_OUT — $GIF_SIZE_HUMAN ($GIF_SIZE_BYTES bytes)"

# Launch-plan Gate B1 acceptance: under 6 MB, under 15 seconds.
LIMIT=$((6 * 1024 * 1024))
if [ "$GIF_SIZE_BYTES" -gt "$LIMIT" ]; then
  echo "WARN: GIF is $GIF_SIZE_HUMAN, over the 6 MB launch-plan ceiling. Consider tightening Sleeps in the tape." >&2
fi
echo "[next] git add assets/peek-hero.gif && git commit -s -m 'docs(assets): peek hero GIF (Gate B1)'"
