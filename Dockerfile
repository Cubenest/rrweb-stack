# Glama MCP-eval image for `@peekdev/mcp` (the peek MCP server).
#
# Why a Dockerfile at repo root: Glama's scoring pipeline auto-discovers a
# Dockerfile here and uses it to run `tools/list` against the server in an
# isolated container. Glama documents this at
# https://glama.ai/mcp/servers/Cubenest/rrweb-stack and a maintainer can also
# paste this file into the Glama dashboard directly.
#
# Why pre-install at build time (vs. `npx --yes` at runtime): the eval pipeline
# pipes JSON-RPC frames on stdin and reads framed responses on stdout. Running
# npm install inside the same `docker run` invocation mingles install chatter
# with the MCP handshake on the same FDs. Pre-installing at build time keeps
# runtime stdio purely the server's, which is what `tools/list` requires.
#
# peek-mcp is a stdio-only MCP server (ADR-0011): no HTTP listener, no native
# host on the eval path. The published `@peekdev/mcp` tarball contains a
# postinstall script that DRY-RUNS the native-host registration (prints what
# it would write) unless `PEEK_INSTALL_NATIVE_HOST=1` — which we deliberately
# do NOT set here, so install is filesystem-clean.

FROM node:22-slim@sha256:813a7480f28fdadac1f7f5c824bcdad435b5bc1322a5968bbbdef8d058f9dff4  # node:22-slim

WORKDIR /srv/peek-mcp
RUN chown -R node:node /srv/peek-mcp

# Drop privileges before the install (Trivy DS-0002 / OWASP container
# hardening). The `node` user ships in the official node image.
USER node

# Pre-install peek-mcp so runtime is pure stdio. `--no-fund --no-audit` keeps
# the install output minimal; `--no-update-notifier` suppresses npm's
# self-update banner. `--ignore-scripts=false` is the default; we WANT the
# postinstall to run (it's a dry-run print, not a real native-host write).
RUN npm init -y >/dev/null 2>&1 \
 && npm install --no-fund --no-audit --no-update-notifier @peekdev/mcp@latest

# Run the installed MCP server binary directly. Stdin = JSON-RPC frames,
# stdout = framed responses (matching the stdio-smoke test in the package).
CMD ["node", "/srv/peek-mcp/node_modules/@peekdev/mcp/dist/index.js"]
