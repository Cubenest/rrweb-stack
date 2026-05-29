#!/usr/bin/env bash
# Stage a clean WDIO fixture at /tmp/tracelane-hero-demo, then run vhs
# against assets/tracelane-hero.tape to produce assets/tracelane-hero.gif.
#
# Idempotent: re-running this script always RESETS the fixture to its
# "before `npx tracelane init`" state so the recording shows the init
# doing real work (install + conf edit + reports dir + .gitignore append),
# rather than a no-op idempotent re-run.
#
# Prereqs:
#   - vhs    (brew install vhs)
#   - node   (>= 22 to match @tracelane/cli's engines)
#   - npm    (>= 10, ships with Node 22)
#   - jq     (used inside the tape to pretty-print devDependencies)
#
# Outputs:
#   assets/tracelane-hero.gif    — the README hero asset (~1-3 MB target)
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEMO_DIR="/tmp/tracelane-hero-demo"
TAPE="$REPO_ROOT/assets/tracelane-hero.tape"
GIF_OUT="$REPO_ROOT/assets/tracelane-hero.gif"

# --- Preflight ----------------------------------------------------------

for cmd in vhs node npm jq; do
  if ! command -v "$cmd" >/dev/null 2>&1; then
    echo "ERROR: '$cmd' is not on PATH. Install it first." >&2
    if [ "$cmd" = "vhs" ]; then echo "  brew install vhs" >&2; fi
    if [ "$cmd" = "jq" ]; then echo "  brew install jq" >&2; fi
    exit 1
  fi
done

NODE_MAJOR=$(node -p "process.versions.node.split('.')[0]")
if [ "$NODE_MAJOR" -lt 22 ]; then
  echo "ERROR: Node 22+ required, found $(node -v)" >&2
  exit 1
fi

# --- Stage the fixture --------------------------------------------------

# Two states matter:
#   1. node_modules populated (slow to set up — full WDIO + transitive deps)
#   2. project files in "before init" state (fast to reset)
#
# Strategy: populate node_modules ONCE (cached across re-runs of this
# script), then on every run reset the project files to "before init" so
# the recording shows real init work.

if [ ! -d "$DEMO_DIR/node_modules" ]; then
  echo "[stage] First-time setup at $DEMO_DIR (will install WDIO + deps; ~1-2 min)"
  rm -rf "$DEMO_DIR"
  mkdir -p "$DEMO_DIR/test/specs"

  cat > "$DEMO_DIR/package.json" <<'JSON'
{
  "name": "tracelane-hero-demo",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "devDependencies": {
    "@wdio/cli": "^9.0.0",
    "@wdio/local-runner": "^9.0.0",
    "@wdio/mocha-framework": "^9.0.0",
    "@wdio/spec-reporter": "^9.0.0",
    "@wdio/types": "^9.0.0",
    "webdriverio": "^9.0.0"
  }
}
JSON

  (cd "$DEMO_DIR" && npm install --silent --no-audit --no-fund 2>&1 | tail -3)
else
  echo "[stage] Reusing cached node_modules at $DEMO_DIR/node_modules"
fi

# Reset all the "tracelane-touched" surfaces to their pristine state so
# the next vhs run records a fresh init flow.
echo "[stage] Resetting tracelane state in $DEMO_DIR (pristine for the recording)"

# Strip @tracelane/wdio from devDeps if a prior run added it.
cat > "$DEMO_DIR/package.json" <<'JSON'
{
  "name": "tracelane-hero-demo",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "devDependencies": {
    "@wdio/cli": "^9.0.0",
    "@wdio/local-runner": "^9.0.0",
    "@wdio/mocha-framework": "^9.0.0",
    "@wdio/spec-reporter": "^9.0.0",
    "@wdio/types": "^9.0.0",
    "webdriverio": "^9.0.0"
  }
}
JSON

cat > "$DEMO_DIR/wdio.conf.ts" <<'TS'
import type { Options } from '@wdio/types';

export const config: Options.Testrunner = {
  runner: 'local',
  framework: 'mocha',
  specs: ['./test/specs/**/*.ts'],
  capabilities: [
    {
      browserName: 'chrome',
      'goog:chromeOptions': {
        args: ['--headless=new', '--no-sandbox', '--disable-gpu'],
      },
    },
  ],
  reporters: ['spec'],
  mochaOpts: { ui: 'bdd', timeout: 60_000 },
  logLevel: 'warn',
};
TS

cat > "$DEMO_DIR/test/specs/login.e2e.ts" <<'TS'
import { browser, $, expect } from '@wdio/globals';

describe('login flow', () => {
  it('shows the dashboard after a valid login', async () => {
    // Deliberately failing so tracelane has something to record.
    await browser.url('about:blank');
    await expect($('[data-test="dashboard"]')).toBeDisplayed();
  });
});
TS

# Remove any prior tracelane state.
rm -rf "$DEMO_DIR/tracelane-reports" "$DEMO_DIR/.tracelane-init.backup"
# Remove @tracelane/wdio from node_modules if a prior init left it there.
rm -rf "$DEMO_DIR/node_modules/@tracelane"
# Reset .gitignore.
cat > "$DEMO_DIR/.gitignore" <<'GIT'
node_modules/
GIT

# --- Record -------------------------------------------------------------

# vhs runs with cwd=$DEMO_DIR so the tape's `Output "tracelane-hero.gif"`
# directive writes to $DEMO_DIR/tracelane-hero.gif. We move it to the
# repo's assets/ dir after recording.
echo "[record] Running vhs against $TAPE (cwd=$DEMO_DIR)"
(cd "$DEMO_DIR" && vhs "$TAPE")

if [ ! -f "$DEMO_DIR/tracelane-hero.gif" ]; then
  echo "ERROR: $DEMO_DIR/tracelane-hero.gif was not produced by vhs" >&2
  exit 1
fi

mv "$DEMO_DIR/tracelane-hero.gif" "$GIF_OUT"

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
echo "[next] git add assets/tracelane-hero.gif && git commit -s -m 'docs(assets): tracelane hero GIF (Gate B1)'"
