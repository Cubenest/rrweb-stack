# peek — Chrome Web Store submission (copy-paste scaffold)

> **What this is:** the exact text + assets to paste into each field of the
> Chrome Web Store developer dashboard submission form, consolidated from the
> repo's source-of-truth docs. **Do not edit listing copy here and expect it to
> sync** — the dashboard is the live surface; this file is the staging copy.
>
> **Sources (keep this file in sync if they change):**
> [`PERMISSION_JUSTIFICATION.md`](../PERMISSION_JUSTIFICATION.md) ·
> [`PRIVACY_POLICY.md`](../PRIVACY_POLICY.md) ·
> built manifest `packages/peek-extension/.output/chrome-mv3/manifest.json`.

## Pre-submit checklist

- [ ] **Packaged zip** — `pnpm --filter @peekdev/extension build`, then zip the
      contents of `packages/peek-extension/.output/chrome-mv3/` with
      `manifest.json` at the **zip root** (a ready zip is produced at
      `packages/peek-extension/peek-extension-<version>-chrome-mv3.zip` — an
      untracked build artifact; rebuild before submitting so it matches HEAD).
- [ ] **5 screenshots** — `assets/cws/screenshots/0[1-5].png` (1280×800 or 640×400).
- [ ] **Small promo tile** — `assets/cws/promo-tile-440x280.png` (440×280).
- [ ] **Store icon** — 128×128 is bundled at `icon/128.png` inside the zip.
- [ ] **Privacy policy URL is live & public** — <https://peek.cubenest.in/privacy> (verified 200).
- [ ] **Manifest ↔ justification parity** — the `permissions` / `optional_permissions` /
      `host_permissions` / `optional_host_permissions` arrays match the rows below.

---

## 1 · Store listing tab

**Product name**
```
peek
```

**Summary** (short description, ≤132 chars — current manifest description, 76 chars)
```
Capture your real browser session and expose it to AI coding agents via MCP.
```

**Category**
```
Developer Tools
```

**Language**
```
English (United States)
```

**Detailed description**
```
peek records your real browser session — DOM, console, and network — and exposes it to your local AI coding agent (Claude Code, Cursor, Cline, Windsurf, and any MCP client) through a Model Context Protocol (MCP) server. Instead of pasting screenshots or describing a bug from memory, your agent reads exactly what your browser saw.

Everything stays on your machine. The extension ships captured sessions through a native-messaging stdio bridge to a local MCP server (peek-mcp) that writes to a local SQLite database. No cloud, no sign-up, no telemetry, no analytics, no third-party SDKs. The code is Apache-2.0 — you can verify the network surface yourself.

How it works
• Enable peek per site from the side panel. There is no "read and change all your data on all websites" — recording is per-origin opt-in, requested from a click.
• peek records a masked rrweb session. Form values and password/email inputs are masked in the page before anything leaves it.
• Point your AI agent at the peek-mcp server. It can list recent sessions, read console and network errors, find the user action that preceded an error, reconstruct the DOM at any moment, query DOM history, and generate a runnable Playwright reproduction.
• A five-level, per-origin permission model controls what the agent may do — from read-only, to suggest, to act-with-confirmation. A destructive-action blocklist (delete, transfer, pay, …) always asks for confirmation, even at the most permissive level.

peek is a free, open-source, self-hosted companion for AI-assisted debugging. It is pre-1.0 alpha and side-project–maintained; the extension also runs unpacked today for early testers.

Source & docs: https://github.com/Cubenest/rrweb-stack  ·  https://peek.cubenest.in
```

**Screenshots** — upload `assets/cws/screenshots/01.png` … `05.png`
**Small promotional tile (440×280)** — upload `assets/cws/promo-tile-440x280.png`

---

## 2 · Privacy practices tab

**Single purpose** (paste verbatim — from `PERMISSION_JUSTIFICATION.md`)
```
peek's single purpose: let a developer record their authenticated browser session on opted-in sites and expose that recording to local AI coding assistants via a stdio MCP bridge. All recording, storage, and replay happen on the user's machine.
```

**Permission justifications** (one field per permission in the dashboard)

| Permission | Paste this justification |
|---|---|
| `activeTab` | Injects the rrweb recorder into the user-clicked tab without holding a broad host permission. Used by chrome.scripting.executeScript when the side panel's "Enable" button is clicked; covers the gesture-bound case where a full origin grant up front would fail on click handlers that navigate immediately (SPA routing). |
| `scripting` | Programmatic chrome.scripting.executeScript for MAIN-world rrweb injection. The rrweb engine must run in the page's MAIN world to observe real DOM mutations; a static ISOLATED-world content script cannot access the page's window/document. |
| `storage` | Persists per-site opt-in state, per-origin permission level (0–4), the Deep-capture per-origin toggle, and side-panel UI state via chrome.storage.sync / chrome.storage.session. localStorage is per-origin and unavailable in the service worker. |
| `tabs` | Reads tab.url / tab.title to gate recorder injection on per-origin opt-in, label "Recording: example.com" in the side panel, and detach the debugger from every tab of an origin when Deep capture is disabled (privacy enforcement). activeTab does not surface tab.url for non-active tabs, which the revocation path requires. |
| `sidePanel` | The peek UI is a side panel that must stay open while the user reads code in their AI tool and approves a proposed action. An action popup closes on blur and cannot host the action-authorization UX. |
| `nativeMessaging` | The service worker connects to a local stdio host (peek-mcp --native-host) via chrome.runtime.connectNative('com.cubenest.peek') to (a) keep the MV3 service worker alive and (b) ship captured events to a local SQLite database with no sockets, no localhost HTTP server, and no DNS lookups. Avoids the DNS-rebinding risk of loopback HTTP transports. |
| `debugger` | "Deep capture" mode records HTTP response bodies via the Chrome DevTools Protocol Network domain. Off by default and gated by a per-origin toggle; chrome.debugger.attach() runs only when the user explicitly enables Deep capture for a site. chrome.webRequest cannot return response bodies in MV3, so the debugger is the only API that exposes them. (Declared statically because Chrome 121+ disallows debugger as an optional permission.) |

**Host permission justification**
```
host_permissions is empty — peek requests no static host access, so the install card shows no broad-host warning. The broad https://*/* and http://*/* patterns live only in optional_host_permissions and are requested from a user gesture in the side panel (chrome.permissions.request) once per site the user enables. http://*/* is required so recording works on local dev servers, a primary use case.
```

**Are you using remote code?**
```
No. CSP is "script-src 'self' 'wasm-unsafe-eval'; object-src 'self';" — scripts load only from the extension's own packaged files. No remote scripts, no inline scripts, no eval. ('wasm-unsafe-eval' permits WebAssembly compilation; it is distinct from 'unsafe-eval' and Chrome-MV3-allowed. Some validators substring-match "unsafe-eval" and flag this — it is a documented false positive.)
```

**Data usage** (check the boxes that apply, then the three certifications)

peek **processes** the following, but **stores it only on the user's local machine** and **transmits none of it to the developer or any third party**:
- *Website content* — DOM/interaction events (masked rrweb), console arguments (masked), network metadata (URL path masked; method/status/timing), and — only under opt-in Deep capture — masked response bodies (≤256 KB).

Disclosures to make:
- **Website content** — collected. **Used only for the single purpose** (local AI-assisted debugging). **Not sold; not transferred to third parties; not used for creditworthiness/lending; not used for purposes unrelated to the single purpose.**
- peek collects **no** PII, authentication info, location, financial info, health info, personal communications, web history, or user activity **transmitted off-device** — masking is applied in-page before anything leaves it, and nothing leaves the machine.

Certify all three required statements:
- [x] I do not sell or transfer user data to third parties, outside of the approved use cases.
- [x] I do not use or transfer user data for purposes unrelated to my item's single purpose.
- [x] I do not use or transfer user data to determine creditworthiness or for lending purposes.

**Privacy policy URL**
```
https://peek.cubenest.in/privacy
```

---

## 3 · Distribution / notes

- **Visibility:** Public (or Unlisted for a quieter alpha — maintainer's call).
- **Pricing:** Free.
- The announce post may say **"Chrome Web Store submission pending"** — peek runs
  unpacked today and CWS review takes 3–10 business days; do not block the launch on approval.
- **Limited Use compliance:** peek's use of any data obtained through the permissions
  above adheres to the Chrome Web Store User Data Policy, including the Limited Use
  requirements — data is used solely to provide the single purpose, stays on-device, and
  is never sold or transferred. (Restate in the listing if the form asks.)
