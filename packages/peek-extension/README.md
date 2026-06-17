<img src="https://raw.githubusercontent.com/Cubenest/rrweb-stack/main/assets/brand/sub-peek.svg" height="40" alt="peek">

# @peekdev/extension

> Your real browser, exposed to your AI coding agent over MCP — capture once, query forever, never leaves your machine.

[![CI](https://github.com/Cubenest/rrweb-stack/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/Cubenest/rrweb-stack/actions/workflows/ci.yml)
[![OpenSSF Scorecard](https://api.scorecard.dev/projects/github.com/Cubenest/rrweb-stack/badge)](https://scorecard.dev/viewer/?uri=github.com/Cubenest/rrweb-stack)
[![license](https://img.shields.io/github/license/Cubenest/rrweb-stack.svg)](https://github.com/Cubenest/rrweb-stack/blob/main/LICENSE)
![status: alpha](https://img.shields.io/badge/status-alpha-orange.svg)

peek's Chrome MV3 extension — side panel UI, per-site activation, MAIN-world rrweb recorder, and the native-messaging bridge to [`@peekdev/mcp`](https://github.com/Cubenest/rrweb-stack/tree/main/packages/peek-mcp). The extension package is **not published to npm** — it's loaded unpacked by alpha testers, with Chrome Web Store submission landing in Phase 5. The user-facing install path is [`@peekdev/cli`](https://www.npmjs.com/package/@peekdev/cli):

```sh
npm install -g @peekdev/cli && peek init
```

`peek init` lays down the native messaging host + your AI client's MCP config; the extension installs from CWS (post-listing) or unpacked (now).

## Install (alpha)

1. Build: `pnpm --filter @peekdev/extension build`.
2. Load `packages/peek-extension/.output/chrome-mv3/` via
   `chrome://extensions` → "Load unpacked".
3. Install the native host: `pnpm --filter @peekdev/cli build && node
   packages/peek-cli/dist/bin.js install` (writes the native-messaging
   manifest under `~/Library/Application Support/Google/Chrome/NativeMessagingHosts/`
   on macOS, or the equivalent on Linux / Windows).

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

## Privacy

peek is local-first. Nothing leaves your machine. See
[`docs/peek/PRIVACY_POLICY.md`](../../docs/peek/PRIVACY_POLICY.md) for the
full data-handling policy, and
[`docs/peek/PERMISSION_JUSTIFICATION.md`](../../docs/peek/PERMISSION_JUSTIFICATION.md)
for per-permission justifications (the Chrome Web Store submission text).

## License

Apache 2.0. DCO sign-off required on contributions (`git commit -s`).
