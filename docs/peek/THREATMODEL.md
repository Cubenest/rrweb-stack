# peek — threat model (DRAFT)

**Status:** stub. To be filled in before public Chrome Web Store submission
(Phase 5 launch gate). Existence-tracking only — the gap is intentionally
visible.

**Owner:** harry-harish.

This file enumerates the attack surfaces and existing / outstanding
mitigations for `@peekdev/extension`, `@peekdev/mcp`, and `@peekdev/cli`.
Cross-referenced from [`SECURITY.md`](../../SECURITY.md) and the
project's pre-launch supply-chain hygiene controls (see
`docs/SUSTAINABILITY.md` §"Pre-launch hygiene controls").

When this stub is replaced, follow the format described in the OSS
Maintenance Field Manual §5.3 — one surface per row in each table,
explicit grade (`mitigated` / `partial` / `accepted` / `open`), and a
"why we live with it" column for any accepted risk.

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

## Delegated consent (connectors — SP3b)

SP3b introduces a **delegated-consent path** for elicitation-capable connectors
(e.g. a Slack bot). When such a connector obtains a human's approval off-device,
`peek-mcp` attaches `consentDelegated: true` to the action request, and the
extension service worker (SW) skips its Level-3 local confirm banner for
**non-destructive** actions, dispatching banner-less and recording a distinct
`connector-elicit` approver in the audit log.

### Trust posture

**The Level-3 human checkpoint moves off-device** for the delegated path. The
local banner — which defends against a local process acting without the human
noticing — is replaced, for that path, by a human approval on the connector's
chat surface (e.g. a Slack message the user explicitly approved).

This rests on **local-bridge trust**: the SW trusts the local peer (`peek-mcp`)
to have faithfully obtained a human's consent before asserting
`consentDelegated`. A malicious local process could forge the flag. This path is
therefore **not cryptographically stronger** than the ordinary Level-3 local
banner without further attestation.

**Cryptographic hardening** (pairing / attestation between the connector and the
SW) is deferred to **SP4**. Until SP4 ships, the delegated-consent path carries
the same trust grade as the existing native-messaging stdio bridge — accepted
risk, local-peer-trust class.

### Unconditional local guards that remain

These guards apply regardless of `consentDelegated` and do not depend on the
connector:

- **Destructive actions always force the local banner.** The SW, not the
  connector, classifies actions as destructive. No connector-supplied flag can
  bypass this gate.
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

### Attack surface row

| Surface | Threat | Grade | Notes |
|---|---|---|---|
| `consentDelegated` flag on stdio pipe | Malicious local process forges flag to bypass Level-3 local banner for non-destructive actions | `accepted` (local-peer-trust class) | Unconditional destructive guard + TOCTOU re-check + Level ≥ 3 precondition still apply. Cryptographic close = SP4 (pairing/attestation). |

## Cross-references

- [`docs/peek/PRIVACY_POLICY.md`](PRIVACY_POLICY.md)
- [`docs/peek/PERMISSION_JUSTIFICATION.md`](PERMISSION_JUSTIFICATION.md)
- [`docs/SECURITY-NOTES.md`](../SECURITY-NOTES.md)
- [`SECURITY.md`](../../SECURITY.md)
- [`docs/SUSTAINABILITY.md`](../SUSTAINABILITY.md) §"Pre-launch hygiene controls"
- ADR-0007 / 0008 / 0009 / 0010
