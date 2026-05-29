# peek — Chrome Web Store Permission Justifications

This is the literal Chrome Web Store submission text for the per-permission
**"Purpose"** field. Source of truth for the declared permissions is
[`packages/peek-extension/wxt.config.ts`](../../packages/peek-extension/wxt.config.ts);
this table must stay in sync with that manifest.

## Single-purpose statement

peek's single purpose: **let a developer record their authenticated browser
session on opted-in sites and expose that recording to local AI coding
assistants via a stdio MCP bridge.** All recording, storage, and replay
happen on the user's machine.

## Host permissions

| Field | Value | Justification |
|---|---|---|
| `host_permissions` | `[]` (empty) | peek deliberately requests **no static host permissions**. The install card shows no "Read and change your data on all websites" warning. See ADR-0008. |
| `optional_host_permissions` | `https://*/*`, `http://*/*` | Recording must be opt-in per site. The broad pattern lives in `optional_host_permissions` and is requested **from a user gesture** in the side panel via `chrome.permissions.request({ origins: [origin] })` — once per site the user enables. Narrower alternatives (e.g. only `https://*/*`) would break recording on local dev servers, which is a primary use case. |

## Permissions (static)

These are declared in `manifest.permissions` and granted at install time.

| Permission | Use case | Why narrower won't work |
|---|---|---|
| `activeTab` | Inject the rrweb recorder into the user-clicked tab without holding a broad host permission. Used by `chrome.scripting.executeScript` when the side panel's "Enable" button is clicked. | Without `activeTab`, every "Enable on this site" click would require a full origin grant up front, which fails on click handlers that navigate immediately (e.g. SPA routing). `activeTab` covers the gesture-bound case where the user has just clicked the toolbar action. |
| `scripting` | Programmatic `chrome.scripting.executeScript` for MAIN-world rrweb injection. The rrweb engine must run in the page's MAIN world to access the real DOM. | A static `<script>` content script runs only in ISOLATED world (no access to the page's `window` / `document` mutations). `world: 'MAIN'` execution requires `chrome.scripting`. |
| `storage` | Persist per-site opt-in state, per-origin permission level (0-4), Deep-capture per-origin toggle, and side-panel UI state via `chrome.storage.sync` / `chrome.storage.session`. | No narrower API exists. `localStorage` is per-origin and unavailable in the service worker. |
| `tabs` | Read `tab.url` / `tab.title` to (a) gate recorder injection on per-origin opt-in, (b) display "Recording: example.com" in the side panel, (c) detach the debugger from **every** tab of an origin when Deep capture is disabled (privacy enforcement, not lazy). Concrete call sites: `chrome.tabs.get`, `chrome.tabs.query({active})`, `chrome.tabs.query({url: '${origin}/*'})`, `chrome.tabs.query({})` for the privacy-revocation enumeration at `entrypoints/background.ts:403`, plus reading `tab.url` inside `chrome.tabs.onUpdated` / `onActivated` handlers. | The narrower `activeTab` does not surface `tab.url` for non-active tabs, which is required for the Deep-capture privacy-revocation path. **Audit-verified 2026-05-29:** grep of `chrome.tabs.*` across `packages/peek-extension/src/` + `entrypoints/` confirms every call needs `tabs`. The 2026-05-29 manifest auditor's I-1 ("consider dropping `tabs`") was investigated and rejected — usage is load-bearing. |
| `sidePanel` | The peek UI is a side panel. It needs to stay open while the user reads code in their AI tool and decides whether to approve a proposed action ("Claude wants to click *Submit*"). Popups close on blur, so they cannot host the action-authorization UX. | `chrome.action` popup closes on focus loss. The action-authorization flow requires a persistent surface; only `sidePanel` provides that without host permissions (see ADR-0008 + the Chrome DevRel side-panel privacy-win note in P2 PRD §A.5). |
| `nativeMessaging` | The service worker connects to a local stdio host (`peek-mcp --native-host`) via `chrome.runtime.connectNative('com.cubenest.peek')`. The connection serves a dual purpose: (a) keeps the MV3 SW alive (Chrome's documented native-port keep-alive anchor), and (b) ships captured events to the local SQLite database **without** opening any sockets or DNS lookups. | A localhost HTTP server would require a host permission for `http://localhost:*/*`, plus would expose peek to DNS-rebinding attacks (the modelcontextprotocol/typescript-sdk docs flag this as the canonical risk of loopback transports). `nativeMessaging` is the documented Chrome pattern for stdio-only host integration. |
| `debugger` | "Deep capture" mode — records HTTP response bodies (and request bodies, headers, and timing) via the Chrome DevTools Protocol `Network` domain. **Off by default — gated by the per-origin Deep capture toggle in the side panel.** `chrome.debugger.attach()` only runs when the user explicitly enables Deep capture for a site; disabling it detaches from every tab of that origin immediately (privacy fix tracked under task #51). | `chrome.webRequest` cannot return response bodies in MV3 by design. `chrome.debugger` is the only Chrome API that exposes response bodies. The "[extension name] started debugging this browser" yellow banner Chrome shows when the debugger attaches is documented and cannot be suppressed; we surface this in the toggle's confirmation copy. **`debugger` is declared statically (not in `optional_permissions`) because Chrome 121+ removed it from the allowed set of MV3 optional permissions** (P-14, 2026-05-28 QA walk); the only alternative was dropping Deep capture entirely. The install card now shows the read-and-modify-all-data warning; behavior remains opt-in via the toggle. |

> **Removed before alpha.6 CWS submission (2026-05-29 architect review):** `alarms`, `offscreen`, `webRequest` were previously declared but never called from `src/`. CWS reviewers grep declared permissions and challenge "where do you use this?" The full rationale below for each is preserved verbatim so the rows can be reinstated with the feature that needs them:
>
> - `alarms` — periodic stale-session cleanup + reconnect backoff. `setTimeout` is unreliable in MV3 SWs (terminate after 30 s idle, timers lost); `chrome.alarms` is the MV3-safe pattern. Re-add when stale-session cleanup ships.
> - `offscreen` — DOM-needing SW work (parsing HAR snippets, decoding `Blob` bodies). The SW has no `document`. Re-add with the offscreen document for body decoding.
> - `webRequest` (non-blocking observation only; **not** `webRequestBlocking`) — covers SW-initiated traffic + cross-origin redirect final URLs that page-side fetch/XHR can't see. Re-add when the signal it captures becomes a feature.

## Optional permissions (runtime)

None at install time beyond `optional_host_permissions` (above). The previous
`debugger` entry moved to static `permissions` in alpha.4 — see the rationale
in the row above.

## Cross-references

- **ADR-0008** — per-site activation, no `<all_urls>` in host_permissions.
- **ADR-0009** — native-messaging port as MV3 SW keep-alive anchor.
- **ADR-0010** — five-level permission model + Deep-capture opt-in.
- **P2 PRD §A.5** — original permission justification source.
- **Privacy policy** — [`PRIVACY_POLICY.md`](./PRIVACY_POLICY.md).

## Content Security Policy

`content_security_policy.extension_pages`: `"script-src 'self' 'wasm-unsafe-eval'; object-src 'self';"`

- `'self'` — scripts only from the extension's own packaged files; no remote scripts, no inline scripts, no `eval`.
- `'wasm-unsafe-eval'` — permits WebAssembly compilation. This is a Chrome MV3-allowed directive **distinct from** `'unsafe-eval'`; it enables WASM without enabling JS `eval()`. peek does not currently ship any WASM, but the rrweb fork retains the option (e.g. for `@posthog/rrweb` compression worklets); the directive is left in for forward compatibility and to match the upstream rrweb CSP.

**Validator false-positive note:** some Manifest V3 validators (including the `chrome-extension-builder:manifest-auditor` plugin v1.2.2 used in this repo's Phase 4 audit) do a substring match on `unsafe-eval` and incorrectly flag `'wasm-unsafe-eval'` as a violation. The directive is explicitly allowed by Chrome's [MV3 CSP policy](https://developer.chrome.com/docs/extensions/reference/manifest/content-security-policy) and CWS does not reject it. The validator finding is annotated here as a known false positive — no code change required.

## Auditing the manifest

To verify the live manifest matches this document, build the extension and
inspect the emitted manifest:

```sh
pnpm --filter @peekdev/extension build
cat packages/peek-extension/.output/chrome-mv3/manifest.json
```

The `permissions`, `optional_permissions`, `host_permissions`, and
`optional_host_permissions` arrays must match the rows above exactly. CI
should fail if they drift; if you change `wxt.config.ts`, update this table
in the same commit.
