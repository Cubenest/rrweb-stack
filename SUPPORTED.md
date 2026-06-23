# Supported versions and compatibility

This document is the canonical compat matrix for every package in
`rrweb-stack`. It is referenced from [`SECURITY.md`](SECURITY.md) and
linked from each package's README.

If you are evaluating these packages for production use, treat them as
alpha-tier OSS — pin a version, audit before adopting, and follow the
deprecation policy at the bottom of this file. See also
[`docs/SUSTAINABILITY.md`](docs/SUSTAINABILITY.md) for the side-project
posture.

## Package matrix

| Package | Latest published | Status | Runtime targets |
|---|---|---|---|
| [`@cubenest/rrweb-core`](packages/rrweb-core) | `0.1.0-alpha.1` | alpha — shared substrate | Node 22+, modern browsers (ESM) |
| [`@tracelane/core`](packages/tracelane-core) | `0.1.0-alpha.3` | alpha | Node 22+ |
| [`@tracelane/report`](packages/tracelane-report) | `0.1.0-alpha.3` | alpha | Node 22+ (build), modern browser (offline HTML) |
| [`@tracelane/wdio`](packages/tracelane-wdio) | `0.1.0-alpha.3` | alpha | Node 22+, WebdriverIO 9, Chrome stable |
| [`@peekdev/mcp`](packages/peek-mcp) | `0.1.0-alpha.3` | alpha | Node 22+, macOS / Linux / Windows |
| [`@peekdev/cli`](packages/peek-cli) | `0.1.0-alpha.5` | alpha | Node 22+, macOS / Linux / Windows |
| [`@peekdev/extension`](packages/peek-extension) | `0.1.0-alpha.3` | alpha (not on npm) | Chrome / Chromium / Edge / Brave ≥ 116 |

Only the **latest published** version of each package receives security
fixes during the alpha series. Once a package ships `1.0`, the latest
minor of the latest major receives fixes; older majors are best-effort.

## Detailed compatibility

### `@cubenest/rrweb-core`

- Node 22+ for the build; consumers should be Node 22+ to match.
- Browser bundle is ESM-only. No CJS export.
- Vendored fork of `@posthog/rrweb@0.0.34` + `@posthog/rrweb-types@0.0.24`
  + `@rrweb/rrweb-plugin-console-record@2.0.0-alpha.20`. Upstream rrweb
  parity tracks `rrweb-io/rrweb@2.0.0-alpha.17`.

### `@tracelane/core` / `@tracelane/report`

- Node 22+.
- `@tracelane/report` produces a self-contained offline HTML report; the
  embedded `rrweb-player@1.0.0-alpha.4` is the lower bound for the
  player surface. Reports written by an older `@tracelane/report` are
  forward-compatible with a newer player.

### `@tracelane/wdio`

- **WebdriverIO 9 only.** Declared as `peerDependencies` `^9.0.0`. The
  WDIO 8 line is past upstream end-of-life — we do not test against it
  and will not patch v8-only regressions. If you need v8, pin
  `@tracelane/wdio@0.1.0-alpha.x` and run with v8 at your own risk
  (the service interface in v8 vs v9 differs slightly; you may need
  to wrap the export yourself).
- Targets Chromium / Chrome stable, last two majors (matches WDIO's
  own target). Playwright integration is not currently supported via
  this package — open an issue if you want it.
- Recorder bundle is built with esbuild as an IIFE and injected via
  `browser.execute`; see [`packages/tracelane-wdio/NOTICE`](packages/tracelane-wdio/NOTICE).

### `@peekdev/mcp`

- Node 22+ on macOS / Linux / Windows.
- **MCP protocol versions:**
  - `2025-03-26` (the first stable spec release — supported as a
    compat layer for older MCP clients).
  - `2025-11-25` (current spec) — primary target.
  - Transports: **stdio** + **Streamable HTTP**. The deprecated
    "HTTP + SSE" transport is **not** supported (per the upstream
    MCP spec which removed it in 2025-11-25).
- Native-messaging host bridge (`peek-mcp --native-host`) bridges the
  Chrome extension's stdio pipe into the same SQLite store used by
  the MCP server — see ADR-0007.

### `@peekdev/cli`

- Node 22+ on macOS / Linux / Windows.
- Read-mostly client of `~/.peek/sessions.db` (POSIX) /
  `%APPDATA%\peek\sessions.db` (Windows). Owns the `peek init`
  MCP-client wizard.
- Built against the same `better-sqlite3` major as `@peekdev/mcp`;
  CLI and MCP versions move together.

### `@peekdev/extension`

- **Chrome ≥ 116** (matches `manifest.json.minimum_chrome_version`,
  set in [`packages/peek-extension/wxt.config.ts`](packages/peek-extension/wxt.config.ts)).
- Chromium-based browsers (Chrome, Edge, Brave, Arc, Opera) on the
  same Chromium base version or later.
- **Not** published to npm. Distribution is via the Chrome Web Store
  for alpha testers — the **peek** extension is available on the
  [Chrome Web Store](https://chromewebstore.google.com/detail/peek/dmgpmkeneheenpdnfmpjjahnkknkaejb)
  (alpha), tracked in `docs/peek/distribution/`. For local builds, load
  it unpacked from `packages/peek-extension/chrome-mv3/`.
- Firefox is **not** supported in the alpha — the WXT scaffold can
  target it later, but the `nativeMessaging` flow differs and would
  require a per-OS native-host installer story we have not built.

## Deprecation policy

These products are side projects with a single committer. The policy
below trades aggressive deprecation for predictability:

1. **Minor releases announce deprecations.** A function, export, MCP
   tool schema field, CLI flag, or extension manifest field marked for
   removal is announced via:
   - A one-shot `console.warn` at the first call site per process
     (Node packages) or one-time toast notification (extension).
   - A line in the affected package's `CHANGELOG.md` under the minor
     that introduces the warning.
   - An entry in the umbrella `docs/SUSTAINABILITY.md` if the change
     affects cross-product API stability.
2. **Sunset is no sooner than 6 months after the deprecation warning,
   and only at the next major.** No "remove in the next minor"; no
   silent removal.
3. **MCP tool schemas never remove fields.** Tool input/output schemas
   are append-only — new optional fields are fine, removing or renaming
   an existing field is a breaking change that requires a new tool
   name (`<tool>_v2`). This matches how the MCP spec itself evolves
   (additive between protocol versions).
4. **`@cubenest/rrweb-core` upstream pin** — the vendored rrweb fork
   is pinned per the README. A rrweb-fork bump is a `@cubenest/rrweb-core`
   minor (or major if the rrweb event format changes).

If you want a heads-up before a deprecation lands, watch
[`docs/SUSTAINABILITY.md`](docs/SUSTAINABILITY.md) and the per-package
`CHANGELOG.md` files. Issues that propose a deprecation are tagged
`deprecation-proposal` on GitHub.

## How to check what is supported right now

```bash
npm view @cubenest/rrweb-core version
npm view @tracelane/core version
npm view @tracelane/report version
npm view @tracelane/wdio version
npm view @peekdev/mcp version
npm view @peekdev/cli version
```

These are the versions currently covered by this document. If `npm view`
returns a newer version than what is listed in the table above, this file
is stale — please open a PR.
