# Security Policy

This file is the single source of truth for reporting vulnerabilities against
any package in this repository (`@cubenest/rrweb-core`, `@tracelane/*`,
`@peekdev/*`).

## Reporting a vulnerability

**Please do not file public GitHub issues for security vulnerabilities.**

Preferred channel:

- **GitHub Private Vulnerability Reporting** — submit at
  <https://github.com/Cubenest/rrweb-stack/security/advisories/new>

If GitHub PVR is unavailable to you for any reason, fall back to:

- A direct message to the maintainer via GitHub (see the [maintainer's
  profile](https://github.com/harry-harish)), then attach the report to a
  draft advisory once we've made contact.

Please **do not** use email for first contact; private vulnerability reporting
on GitHub gives both sides an auditable, scoped channel that survives
maintainer rotation.

## What to include

Useful reports include:

- Affected package + version (e.g. `@peekdev/extension@0.1.0-alpha.3`).
- A minimal reproduction (repo link, gist, or inlined code).
- The CVE or CWE category if known (e.g. CWE-94 code injection).
- Environment: OS, Node version, browser/runner version.
- Your expected disclosure timeline, if you have one in mind.

## Response commitments

- **Acknowledgement** — within **3 business days** of receipt. If you do not
  hear back in that window, please re-ping; assume the report did not arrive.
- **Triage** — initial severity assessment and reproduction status within
  **7 business days** of acknowledgement.
- **Coordinated disclosure** — fix-or-disclose within **90 days from
  acknowledgement**, or at the next release of an affected package,
  whichever is sooner. We will coordinate the public disclosure window with
  you (default is publishing the GitHub Security Advisory + a brief
  CHANGELOG entry on the same day a patched version reaches npm).

We do not currently operate a bug bounty. We will credit reporters in the
published advisory unless you ask otherwise.

## Supported versions

Per-package version support and release cadence are documented in
[`SUPPORTED.md`](SUPPORTED.md). In summary:

- All packages are currently in the `0.1.0-alpha.x` series and only the
  latest published alpha receives security fixes.
- Once a package reaches `1.0`, the latest minor of the latest major will
  receive security fixes; older majors are best-effort and unsupported in
  the absence of an explicit notice.

## Out of scope

The following are explicitly **not** in scope for this advisory channel:

- **Upstream third-party services.** Vulnerabilities in `@posthog/rrweb`,
  `rrweb-io/rrweb`, the Chrome browser, the MCP protocol itself, or any
  other third-party project should be reported to their respective
  maintainers. We will track downstream impact if you tag us, but the
  primary fix belongs upstream.
- **Social engineering** against the maintainer or other contributors.
- **Physical attacks** requiring local access to a user's machine beyond
  what an installed package can achieve via documented OS-level
  permissions.
- **Denial of service via deliberate over-recording** in `peek` — the
  product is local-first and the user controls the recording surface; a
  user who chooses to record large pages and consume their own disk is
  not exhibiting a security flaw.

## Supply-chain hygiene

This repository implements layered defences against npm supply-chain
compromise (chalk/debug Sep 2025, Shai-Hulud / Nx Aug 2025, Shai-Hulud 2.0
/ PostHog Nov 2025):

- **Renovate cooldown** — newly published versions of dependencies must
  age **7 days** before Renovate will open an update PR (21 days for the
  `@posthog/rrweb-*` line that was directly hit by Shai-Hulud 2.0). See
  [`renovate.json`](renovate.json).
- **Pinned GitHub Actions** — every action in
  [`.github/workflows/`](.github/workflows/) is pinned to a 40-character
  commit SHA, never a floating tag.
- **OIDC Trusted Publishing** — npm publishes from
  [`release.yml`](.github/workflows/release.yml) use OIDC, not long-lived
  tokens.
- **OpenSSF Scorecard** — weekly read-only scan, results uploaded as
  SARIF to GitHub's code-scanning surface. See
  [`scorecard.yml`](.github/workflows/scorecard.yml).
- **No `pull_request_target`** — the trigger that enabled the PostHog
  Shai-Hulud 2.0 incident is forbidden in every workflow in this repo.

If you spot a supply-chain regression in any of the above, treat it as a
P0-class report and use the disclosure channel above.

## Privacy disclosures

`peek` is a local-first developer tool — see the privacy posture in
[`docs/peek/PRIVACY_POLICY.md`](docs/peek/PRIVACY_POLICY.md). If you find
a path that breaks the local-first guarantee (any network call to a
non-localhost host outside the documented Chrome native-messaging stdio
pipe), report it via this channel; we will treat it with the same
priority as a code-execution finding.

— harry-harish (maintainer)
