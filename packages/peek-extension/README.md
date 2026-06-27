<img src="https://raw.githubusercontent.com/Cubenest/rrweb-stack/main/assets/brand/sub-peek.svg" height="40" alt="peek">

# @peekdev/extension

> Let your AI coding agent debug what already happened in your real browser — peek passively records masked sessions to a local store and exposes them to your agent over MCP. With explicit per-site consent, the agent can also act. Nothing leaves your machine to a vendor.

[![CI](https://github.com/Cubenest/rrweb-stack/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/Cubenest/rrweb-stack/actions/workflows/ci.yml)
[![OpenSSF Scorecard](https://api.scorecard.dev/projects/github.com/Cubenest/rrweb-stack/badge)](https://scorecard.dev/viewer/?uri=github.com/Cubenest/rrweb-stack)
[![license](https://img.shields.io/github/license/Cubenest/rrweb-stack.svg)](https://github.com/Cubenest/rrweb-stack/blob/main/LICENSE)
![status: alpha](https://img.shields.io/badge/status-alpha-orange.svg)

peek's Chrome MV3 extension — side panel UI, per-site activation, MAIN-world rrweb recorder, a per-origin trust dial that controls what your AI agent may do on the page, and the native-messaging bridge to [`@peekdev/mcp`](https://github.com/Cubenest/rrweb-stack/tree/main/packages/peek-mcp). The extension package is **not published to npm** — but peek is available (alpha) on the [Chrome Web Store](https://chromewebstore.google.com/detail/peek/dmgpmkeneheenpdnfmpjjahnkknkaejb), with loading unpacked still supported for contributors and local builds. The user-facing install path is [`@peekdev/cli`](https://www.npmjs.com/package/@peekdev/cli):

```sh
npm install -g @peekdev/cli && peek init
```

`peek init` lays down the native messaging host + your AI client's MCP config; the extension installs from the [Chrome Web Store](https://chromewebstore.google.com/detail/peek/dmgpmkeneheenpdnfmpjjahnkknkaejb) or unpacked from a local build.

## Install (alpha)

1. Install the **peek** extension from the
   [Chrome Web Store](https://chromewebstore.google.com/detail/peek/dmgpmkeneheenpdnfmpjjahnkknkaejb).
2. Install the native host with the wizard: `npm install -g @peekdev/cli
   && peek init` (writes the native-messaging manifest under
   `~/Library/Application Support/Google/Chrome/NativeMessagingHosts/` on
   macOS, or the equivalent on Linux / Windows, and wires up your AI
   client's MCP config). From a source checkout you can instead run `pnpm
   --filter @peekdev/cli build && node packages/peek-cli/dist/index.js init`.

### Load unpacked (contributors / local builds)

1. Build: `pnpm --filter @peekdev/extension build`.
2. Load `packages/peek-extension/.output/chrome-mv3/` via
   `chrome://extensions` → "Load unpacked".
3. Install the native host as in step 2 above.

## Enable on a site

- Open the side panel from the toolbar.
- Click **Enable on this site**. peek requests the per-origin host
  permission from the user gesture and starts recording.
- When recording is active, a toolbar badge and an in-page glow (closed
  shadow root, excluded from peek's own capture) appear. Toggle **Show
  recording border** in the side panel to hide the glow while the badge
  stays visible.
- (Optional) Toggle **Deep capture** to record response bodies via
  `chrome.debugger`. Off by default. Off detaches every tab of the origin.

## Agent control (trust dial)

peek records by default; it acts only when you raise the per-origin **trust
dial** in the side panel. Five levels (ADR-0010), defaulting to **Read-only**:

- **Off** — peek's tools are turned off for this site.
- **Read** (default) — the agent can read what peek captured; no actions.
- **Suggest** — the agent can highlight elements on the page; no mutation.
- **Confirm** — the agent can click/type/navigate, but you approve each action
  via a side-panel banner (Allow once / Always / Deny).
- **Auto** — the agent acts without prompts; stays on for this site until you
  lower the trust level. A destructive-action blocklist still prompts, even here.

A **Recent actions** disclosure sits under **Agent control** (in-panel preview
landing soon); meanwhile the MCP server records every act-tool call to
`~/.peek/audit.log`.

## Privacy

peek is local-first. Nothing leaves your machine. See
[`docs/peek/PRIVACY_POLICY.md`](../../docs/peek/PRIVACY_POLICY.md) for the
full data-handling policy, and
[`docs/peek/PERMISSION_JUSTIFICATION.md`](../../docs/peek/PERMISSION_JUSTIFICATION.md)
for per-permission justifications (the Chrome Web Store submission text).

## Related packages

- [`@peekdev/cli`](https://github.com/Cubenest/rrweb-stack/blob/main/packages/peek-cli/README.md) — the `peek` command + native-messaging host installer; the user-facing install path for this extension.
- [`@peekdev/mcp`](https://github.com/Cubenest/rrweb-stack/blob/main/packages/peek-mcp/README.md) — the MCP server that exposes captured sessions to your AI coding agent.

See the [threat model](https://github.com/Cubenest/rrweb-stack/blob/main/docs/peek/THREATMODEL.md) for peek's security boundaries and the [CHANGELOG](https://github.com/Cubenest/rrweb-stack/blob/main/packages/peek-extension/CHANGELOG.md) for release notes.

## License

Apache 2.0. DCO sign-off required on contributions (`git commit -s`).
