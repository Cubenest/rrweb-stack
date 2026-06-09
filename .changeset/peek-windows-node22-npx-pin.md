---
"@peekdev/cli": patch
"@peekdev/mcp": patch
---

Fix peek MCP server failing to start on Windows (two independent causes).

1. **npx couldn't resolve the package.** The canonical `mcpServers.peek` block
   `peek init` writes (and the README's manual snippet) used a bare
   `npx -y @peekdev/mcp`. While peek is in alpha, every published version is a
   prerelease (`0.1.0-alpha.*`), and the implicit `*` range npx resolves does
   not match prereleases per semver — npx fails with `ETARGET: No matching
   version found for @peekdev/mcp@*`, so the MCP client reports a connection
   error (`-32000`). The canonical block now pins `@peekdev/mcp@latest`, which
   forces the newest published dist-tag.

2. **No Node 20 prebuilt for the native dependency.** `better-sqlite3@12.x`
   ships win32-x64 prebuilt binaries only for Node 22+ (ABI v127+); on Node 20
   (ABI v115) `prebuild-install` 404s and falls back to compiling from source,
   which fails on a stock Windows box (no MSVC C++ toolchain). macOS hid this
   because it ships a compiler. `engines.node` for both `@peekdev/mcp` and
   `@peekdev/cli` is raised to `>=22` (matching the monorepo root and where
   better-sqlite3 actually publishes prebuilts), and the requirement is now
   documented in the README.
