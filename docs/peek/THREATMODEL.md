# peek — threat model

**Status:** substantive — all eight attack surfaces enumerated, existing
mitigations documented, and outstanding items tracked with explicit scope
labels. The extension is live on the Chrome Web Store. Residual gaps
(content-script isolation hardening, native-host fuzz coverage, CWS
publisher 2FA recovery, CDP-debugger UX wording, `execute_action` schema
versioning) are accepted pre-1.0 scope and tracked below under
[Outstanding mitigations](#outstanding-mitigations).

**Owner:** harry-harish.

This file enumerates the attack surfaces and existing / outstanding
mitigations for `@peekdev/extension`, `@peekdev/mcp`, and `@peekdev/cli`.
Cross-referenced from [`SECURITY.md`](../../SECURITY.md) and the
project's pre-launch supply-chain hygiene controls (see
`docs/SUSTAINABILITY.md` §"Pre-launch hygiene controls").

## Attack surfaces to cover

1. **Chrome MV3 service-worker compromise** — what happens if an attacker
   gets code into `background.ts`. Trust boundary: extension package
   itself.
2. **MAIN-world rrweb-recorder.js IIFE** — the IIFE runs in the page's
   own JS context (not extension isolated world) so a malicious page can
   read / overwrite its globals. Trust boundary: page → extension.
3. **`chrome.runtime.connectNative` stdio pipe** — between the extension
   and `peek-mcp --native-host`. JSON-on-stdio with a 4-byte framing
   header. Trust boundary: extension → native host.
4. **Native-messaging host registration** — `peek install-native-host`
   writes the registration JSON under the user's home directory. Trust
   boundary: CLI → OS user account.
5. **`chrome.debugger` (Deep capture)** — attaches the CDP debugger to
   the user's tab, can read response bodies. Trust boundary: extension
   → all browsing data on that tab.
6. **MCP server `execute_action` tool** — when wired to an AI client,
   the model can request side-effecting actions in the browser. Trust
   boundary: AI client → user's browser.
7. **`~/.peek/sessions.db` + `~/.peek/audit.log`** — SQLite + append-only
   log under the user's home directory; readable by the same OS user.
   Trust boundary: any process running as the user.
8. **Chrome Web Store update channel** — once published, CWS pushes
   updates to all installs. Trust boundary: Cubenest publisher account
   → all extension users.
9. **`share_session` connector upload** — the one path where a recorded
   session bundle leaves the local store and is uploaded to a third-party
   cloud (e.g. Slack via `files.uploadV2`). Trust boundary: peek local
   store → third-party cloud service.
10. **`render_session_journey` canvas render** — a second egress path where a
    session's derived CausalChain (timeline, narrative, error tables) is sent to a
    channel-linked Slack canvas (`conversations.canvases.create`) or Block Kit
    message. Triggered by explicit `@peek rebuild the journey` mention. Trust
    boundary: peek local store → Slack's cloud (wider than a one-line answer,
    narrower than the raw bundle).

## Mitigations already in place

Reference Phase 4a/c artifacts and ADRs. To be expanded inline once the
real threat model is written.

- ADR-0008: no `<all_urls>` in `host_permissions`; per-origin opt-in via
  `chrome.permissions.request({ origins })` at user-gesture time.
- ADR-0009: native-messaging stdio bridge (not localhost HTTP), avoids
  DNS-rebinding risk class.
- ADR-0010: five-level per-origin permission model; default Level 1
  (Observe only); destructive-action blocklist applies even at Level 4
  YOLO.
- `peek-extension/src/relay/mask.ts`: PII masking applied before any
  event leaves the page's content script.
- `peek-extension`: Deep-capture disable detaches `chrome.debugger`
  from every tab of the origin immediately (privacy fix task #51).
- `peek-mcp`: `execute_action` audit log at `~/.peek/audit.log` mode
  0600.
- `peek-cli`: `peek init` MCP wizard refuses to write to a config file
  the current user does not own (pre-init guard).

## Outstanding mitigations

- **Content-script isolation hardening** — the MAIN-world recorder IIFE
  is currently injected without `iframe` source-isolation. A malicious
  page can overwrite the IIFE's exported handle on `window`. Need to
  evaluate moving to a closure-only export + postMessage handshake.
  Pre-1.0 scope.
- **Native-host framing fuzz coverage** — the 4-byte length-prefix
  framing in `peek-mcp/src/native-host/stdio.ts` has unit tests for
  the happy paths but no negative-input fuzzer. Pre-1.0 scope.
- **CWS publisher 2FA recovery** — single-publisher (harry-harish);
  the Cubenest CWS console account needs documented 2FA recovery codes
  printed and stored offline. Tracked under
  [`docs/SUSTAINABILITY.md`](../SUSTAINABILITY.md) §"Named ownership".
- **CDP-debugger banner UX** — Chrome shows "extension started
  debugging this browser" when `chrome.debugger.attach()` is called;
  the toggle's confirmation copy needs a user-test pass to confirm the
  warning is unambiguous.
- **MCP `execute_action` schema versioning** — see deprecation policy
  in [`SUPPORTED.md`](../../SUPPORTED.md); needs an ADR locking in the
  "tool schemas never remove fields, only add" rule before 1.0.

## Delegated consent (connectors — SP3b / SP4)

SP3b introduces a **delegated-consent path** for elicitation-capable connectors
(e.g. a Slack bot). When such a connector obtains a human's approval off-device,
`peek-mcp` attaches `consentDelegated: true` to the action request, and the
extension service worker (SW) skips its Level-3 local confirm banner for
**non-destructive** actions, dispatching banner-less and recording a distinct
`connector-elicit` approver in the audit log.

**SP4** closes the forge-the-flag gap that SP3b documented. The banner-less
Level-3 path now also requires a **verified pairing secret**: a connector must
complete a matching-code trust-dial handshake before its `consentDelegated`
assertion is honoured. See "Pairing handshake (SP4)" below.

### Trust posture

**The Level-3 human checkpoint moves off-device** for the delegated path. The
local banner — which defends against a local process acting without the human
noticing — is replaced, for that path, by a human approval on the connector's
chat surface (e.g. a Slack message the user explicitly approved).

Prior to SP4, this rested on **local-bridge trust** only: a malicious local
process could forge the `consentDelegated` flag. SP4 elevates this by requiring
the connector to present a shared secret minted during pairing. A process that
was never paired on the trust dial cannot produce a valid secret and falls
through to the ordinary Level-3 local banner.

### Pairing handshake (SP4)

When a connector initiates pairing via `peek-mcp` and the user confirms on the
trust-dial UI, the service worker:

1. Generates a cryptographically random secret.
2. Stores only its **SHA-256 hash** in `chrome.storage.local` (keyed by
   connector identity).
3. Returns the **plaintext secret once** — to the connector at pairing time.

On each subsequent `execute_action` request the connector presents the secret;
the SW hashes it and compares against the stored hash. A match is required for
the banner-less delegated-consent path. A mismatch or absent secret causes the
request to fall through to the standard local banner.

Pairings are **revocable** on the trust dial. Revoking a connector deletes its
stored hash, immediately invalidating the secret.

### Residual limits (honest framing)

SP4 substantially hardens the delegated path but does not eliminate all trust
assumptions. The following limits remain:

- **peek trusts that the paired connector actually asked a human** for the
  specific action. This is mitigated by SP3b's design: peek initiates and
  correlates the elicitation prompt, so a paired connector cannot pre-fabricate
  approvals for actions the human never saw.
- **Connector secrets at rest are stored in the OS keychain by default**
  (SP6a; macOS Keychain / Windows Credential Manager / Linux Secret Service),
  with a `0600` file fallback behind `--insecure-store` or when the keychain is
  unavailable. This covers both the pairing secret (SP6a) and the connector's
  platform tokens — Slack `xoxb`/`xapp` (SP6b-1), captured interactively (hidden
  input, never on argv); an environment variable remains a supported fallback
  (used as-is, not persisted) for CI/headless. A local attacker who can read the
  keychain entry (or the fallback file / env) could present a valid secret. The
  pairing model defends against an unpaired local process, not a fully
  compromised user account.
- **The matching code defends the pairing moment against a name-race**, not
  against an attacker who already owns the connector process and its secret
  store.

### Unconditional local guards that remain

These guards apply regardless of `consentDelegated` and do not depend on the
connector or the pairing state:

- **Destructive actions always force the local banner.** The SW, not the
  connector, classifies actions as destructive. No connector-supplied flag —
  and no pairing secret — can bypass this gate.
- **`revalidateAtDispatch` TOCTOU re-check.** Origin and permission level are
  re-validated at dispatch time (not only at request time), preventing
  time-of-check/time-of-use races.
- **Delegation never escalates below Level 3.** `consentDelegated` is only
  honoured when the origin's trust-dial is already at Level 3 or above; it
  cannot be used to elevate a Level 1 or 2 origin.

### Auditability

Delegated dispatches are recorded with the approver tag `connector-elicit` in
`~/.peek/audit.log`, distinct from local-banner approvals (`user`) and
Level-4 auto-approvals (`level-4-auto`). This makes the delegated path
independently auditable.

### Attack surface rows

| Surface | Threat | Grade | Notes |
|---|---|---|---|
| `consentDelegated` flag on local socket | Malicious local process forges flag to bypass Level-3 local banner for non-destructive actions | `mitigated` (SP4 pairing) | SW now also requires a valid pairing secret; an unpaired process falls through to the local banner. Unconditional destructive guard + TOCTOU re-check + Level ≥ 3 precondition still apply. |
| Connector secret at rest (OS keychain by default; `0600` file fallback) | Local attacker reads the keychain entry / fallback file and presents the secret | `accepted` (local-peer-trust class) | Defends against unpaired processes, not a fully compromised user account. SP6a moved the secret to the OS keychain by default; `--insecure-store` selects the `0600` file. |

## Session egress — `share_session` (SP5 / connector upload)

SP5 introduces the **one path where recorded session data leaves peek's
local-first store for a third-party cloud**. The `share_session` MCP tool
exports a recorded session as a `.peekbundle` and hands it to the active
connector for upload to its chat surface (e.g. a Slack thread via
`files.uploadV2`).

### What the bundle contains

A `.peekbundle` is a portable archive of the session's rrweb event stream —
DOM snapshots, console events, and network events. The content is **masked
at capture time** by `peek-extension/src/relay/mask.ts` before it ever reaches
the local store. The masking is a capture-time transformation, not a security
redaction: the bundle contains real session activity, just with PII fields
replaced per the masking rules in effect when the session was recorded. It is
not a sanitised summary.

### Consent gate

`share_session` never runs silently. Before producing any file the tool
presents an explicit egress consent card naming what is being exported and
where. The card uses the same elicitation consent mechanism as
`execute_action` (SP3b) and is independent of the Level-3 act gate: a user
at Level 1 can deny `execute_action` entirely and still encounter the
`share_session` consent card when the connector requests an upload. On
deny, no file is written and the tool returns `{ ok: false, result: 'denied' }`.

### Slack upload path

When the connector is `@peekdev/connector-slack`, the approved bundle is
uploaded to Slack via the `files.uploadV2` API. This requires the
`files:write` OAuth scope on the Slack app. The upload is made by the
connector process using the `xoxb` bot token stored in the OS keychain
(SP6b-1). peek itself does not hold or transmit the Slack token; the
connector receives the `bundlePath` from `share_session` and performs the
upload independently.

### Temp-file lifecycle

The `.peekbundle` is written to a process-scoped temp path with a random
nonce suffix. After the connector reports upload success or failure, the
connector-core layer deletes the temp file. The deletion is best-effort on
failure paths, and the temp path is in the OS temp directory (not
`~/.peek/`), so it is subject to normal OS temp-dir cleanup if the process
exits abnormally before deletion.

### Audit log

Every approved export is recorded to `~/.peek/audit.log` (mode `0600`) as
`tool: share_session`, including the session ID, the surface destination,
and the approver tag (e.g. `connector-elicit` for a delegated-consent
approval). The bundle bytes and the bundle path are never written to the
audit log.

### Residual limits (honest framing)

- **Once the bundle is in Slack it is under Slack's retention and access
  controls**, not peek's. peek's local-first guarantees do not extend past
  the upload boundary. Workspace admins, eDiscovery exports, and Slack's
  own data-retention policies apply to the uploaded file.
- **Masking is capture-time, not security redaction.** If the masking
  configuration at record time was incomplete (e.g. a custom input field
  not covered by the default mask rules), the unmasked value may be in the
  bundle. Users should treat the uploaded bundle with the same care as the
  original session.
- **The consent card names the destination surface but not every downstream
  recipient.** In a public Slack channel the uploaded file is visible to all
  channel members. peek cannot enumerate channel membership at upload time.

### Attack surface rows

| Surface | Threat | Grade | Notes |
|---|---|---|---|
| `share_session` egress to Slack | Recorded session data (masked DOM + console/network) leaves the local store and enters Slack's cloud | `accepted` (explicit consent required) | Gated by an elicitation consent card before any file is written. Temp file deleted after upload. Audit log records the export. Residual: Slack retention applies post-upload; masking completeness depends on capture-time config. |
| Temp `.peekbundle` file on disk | Brief window between bundle write and upload deletion; a local process could read the file | `accepted` (local-peer-trust class) | Temp file has a random-nonce suffix. Sits in OS temp dir with normal umask. Deleted on success and on failure (best-effort). The window is bounded by the upload round-trip latency. |

## Session egress — `render_session_journey` (session-journey / canvas render)

SP7 introduces a second egress path: the `render_session_journey` MCP tool returns a
session's **derived CausalChain** to the active connector for rich rendering
(e.g. a channel-linked Slack canvas). Like `share_session` it sends session-derived
content to a third-party cloud, but the nature of the egress is different.

### What the journey contains

A CausalChain is a **summarised, structured representation** of a session: an
ordered timeline of user actions, DOM mutations, network events, and console
errors; a human-readable narrative; masked field values; and error tables. It is
generated at render time from the locally stored session by the same pipeline as
`get_user_action_before_error`. It is **not** the raw rrweb event stream. No
additional masking is applied by the connector — masking is a capture-time
transformation applied by `peek-extension/src/relay/mask.ts` before any event
reaches the local store.

### Consent gate

`render_session_journey` is initiated by an explicit **`@peek rebuild the journey`**
mention in a Slack channel. The user's mention is the consent event — there is no
separate consent card. This distinguishes the journey path from `share_session`,
which always presents an explicit elicitation consent card before writing any file.
The design rationale is that the command is narrowly scoped (the journey is a
summarised read-path output, not the raw bundle) and the user explicitly named the
action. If the user does not send the command, the canvas is never created.

### Slack render path

When the connector is `@peekdev/connector-slack`, the CausalChain is rendered to
a **channel-linked canvas** via `conversations.canvases.create`. This requires the
`canvases:write` OAuth scope on the Slack app (in addition to the scopes already
required by SP3b/SP5). A clickable permalink to the canvas is posted in the same
Slack thread. When `conversations.canvases.create` is unavailable (e.g. the scope
is absent or the API returns an error), the connector falls back to a Block Kit
message in the thread containing the journey narrative and key timeline entries.

Neither path writes a temp file to disk — the CausalChain is serialised in memory
and transmitted directly to Slack's API.

### How this differs from `share_session`

| Property | `share_session` | `render_session_journey` |
|---|---|---|
| Content | Raw `.peekbundle` (full rrweb event stream) | Derived CausalChain (timeline + narrative + error tables) |
| Consent | Explicit elicitation card before any data leaves | User-initiated `@peek rebuild the journey` mention |
| Slack surface | File upload (`files.uploadV2`) | Channel-linked canvas (`conversations.canvases.create`) or Block Kit fallback |
| Temp file on disk | Yes (deleted after upload) | No |
| Egress breadth | Full session (masked) | Derived summary (masked) — wider than a one-line answer, narrower than the raw bundle |

### Residual limits (honest framing)

- **Once the canvas is in Slack it is under Slack's retention and access
  controls**, not peek's. peek's local-first guarantees do not extend past
  the API call boundary. Channel-linked canvases are visible to all channel
  members. Workspace admins, eDiscovery exports, and Slack's own data-retention
  policies apply.
- **Masking is capture-time, not security redaction.** If the masking
  configuration at record time was incomplete (e.g. a custom input field not
  covered by the default mask rules), the unmasked value may appear in the
  CausalChain. Users should treat the canvas content with the same care as the
  original session.
- **The journey is broader than a one-line answer.** A full timeline + narrative
  for a complex session may contain more detail than a user expects. Users should
  use the command only in channels where the session content is appropriate to share.

### Attack surface rows

| Surface | Threat | Grade | Notes |
|---|---|---|---|
| `render_session_journey` egress to Slack canvas | Derived session data (timeline, narrative, error tables) leaves the local store and enters Slack's cloud | `accepted` (user-initiated command) | Gated by the user explicitly sending `@peek rebuild the journey`. Canvas is channel-linked; visible to channel members. Audit log records the render. Residual: Slack retention applies post-render; masking completeness depends on capture-time config. |
| Block Kit fallback | Journey narrative posted as a Slack message when canvas API is unavailable | `accepted` (same user-initiation gate) | Same consent and content as the canvas path; narrower surface (message vs. canvas) but equally persistent under Slack retention. |

## Cross-references

- [`docs/peek/PRIVACY_POLICY.md`](PRIVACY_POLICY.md)
- [`docs/peek/PERMISSION_JUSTIFICATION.md`](PERMISSION_JUSTIFICATION.md)
- [`docs/SECURITY-NOTES.md`](../SECURITY-NOTES.md)
- [`SECURITY.md`](../../SECURITY.md)
- [`docs/SUSTAINABILITY.md`](../SUSTAINABILITY.md) §"Pre-launch hygiene controls"
- ADR-0007 / 0008 / 0009 / 0010
