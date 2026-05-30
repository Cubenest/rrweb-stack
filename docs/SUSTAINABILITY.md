# Sustainability

This document records the side-project posture for `tracelane` and `peek`, their named owners, the expected maintenance cadence, and the wind-down plan if either project becomes inactive.

It is not a marketing document. It exists to be honest with users and contributors about what they can expect.

## Named ownership

| Product | Owner | npm publisher | GitHub admin |
|---------|-------|---------------|--------------|
| `tracelane` (P1) | harry-harish | `harry-harish` (npm) | `harry-harish` (`Cubenest`) |
| `peek` (P2) | harry-harish | `harry-harish` (npm) | `harry-harish` (`Cubenest`) |
| `@cubenest/rrweb-core` (shared substrate) | harry-harish | `harry-harish` (npm) | — |

A second publisher per scope is being recruited as a Phase 5 pre-launch sustainability gate; tracked at https://github.com/Cubenest/rrweb-stack/issues/9. Until that lands, all three scopes have a single point of failure for releases, which is acknowledged here rather than hidden.

## Cadence

These are side projects. They do not have a fixed deadline, OKR, or marketing budget. The maintenance posture is:

- **No service-level agreement on response time.** Issues, PRs, and security reports are addressed when the owner has bandwidth. Time-sensitive reports (security, broken-on-latest-Chrome) get priority; everything else gets best-effort.
- **No promised release cadence.** Each package releases on Changesets, independently, when there is something worth shipping.
- **No paid infrastructure.** No SaaS, no central server, no usage telemetry, no operating cost. The cost of doing nothing for a quarter approaches zero by design (see `prds/shared-preamble.md` §4).
- **Pinned upstream substrate.** The vendored `@posthog/rrweb` fork in `@cubenest/rrweb-core` moves only when the core package ships a new release. Consumers are not exposed to upstream churn.

If you are evaluating either product for production use, treat them as you would any unmaintained-quality alpha-tier OSS: pin the version, audit before adopting, and be prepared to fork if the project goes quiet.

## "Keep going" signal

External traction is the metric that justifies continued maintainer attention. Concrete per-product thresholds live in the per-PRD success-metrics sections. The principle: traction is measured externally (stars, downloads, integration adoption), not internally (lines of code, time invested).

## Sustainability review cadence

- **First review:** six months after each product's public launch.
- **Subsequent reviews:** annually.
- **What gets reviewed:** traction against the keep-going threshold; the maintainer team's continued bandwidth; external interest.
- **Possible outcomes:** continue at current effort; hand off to a community lead; wind down cleanly.

## Wind-down plan

If a product loses traction or the owner cannot continue, it does not get to rot quietly with broken builds and unanswered issues. The plan is concrete.

### Trigger conditions

Any one of:

- Owner unavailable for 90+ consecutive days without a co-maintainer covering security-class issues.
- A sustainability review (above) decides to wind down.
- A blocking trademark / legal claim that cannot be resolved by renaming.

### Wind-down steps (in order)

1. **Pin a status banner at the top of each product's README:**

   > **Status: not actively maintained as of `<date>`.**
   > Last known-good versions: `@tracelane/core@<ver>`, `@peekdev/cli@<ver>`, etc. Pinned `@posthog/rrweb` fork: `<ref>`. Security disclosure path remains active at `SECURITY.md` (best-effort). Community forks welcomed — link them in a PR to this README.

2. **GitHub:** archive the relevant repository in the `Cubenest` org. Archive sets the repo read-only and adds GitHub's own "this is archived" banner.

3. **npm:** **packages stay published** — do not unpublish or delete. Existing installs continue working; existing tags remain pinnable.

4. **npm deprecation:** mark each affected package with a one-line `npm deprecate` notice pointing readers to the README status banner.

   \`\`\`bash
   npm deprecate '@tracelane/core@*' "tracelane is no longer actively maintained as of <date>. See https://github.com/Cubenest/rrweb-stack#status."
   \`\`\`

5. **Transfer or rename:** if a community fork takes over, link to it from the README and (optionally) transfer the npm scope or rename the repo. Do not delete; transfer.

6. **Security advisory channel:** SECURITY.md disclosure path remains active on best-effort, including after wind-down. A drive-by RCE in a deprecated-but-still-installed package is still our problem until at least the next major-version stable line of `@posthog/rrweb` ships.

### What the wind-down explicitly does NOT do

- Force-unpublish a package (breaks consumers; npm policy discourages it).
- Delete the GitHub repository (breaks deep-links and historical issue threads).
- Remove the `@cubenest/rrweb-core` shared substrate if only one of the two products winds down (the surviving product still depends on it).
- Pretend the project is still active. Silence is not graceful.

## Failure-mode honesty

The most common pure-OSS side-project failure is: the original maintainer's interest fades, the project quietly stops getting updates, and users find out three months later when something breaks. This document and the wind-down plan exist to make that failure mode less likely (by mitigation) and less harmful when it happens (by structured exit).

Reading this document does not mean these projects will fail. It means they are honest about what failure looks like, and what to expect if it happens.

## Pre-launch hygiene 2026-05-29

The following supply-chain hygiene controls landed in a single batched commit
ahead of the public push (Phase 5 pre-launch gate A). None are code changes;
all are docs / config / CI hardening from the OSS Maintenance Field Manual.

- **`SECURITY.md`** rewritten — GitHub Private Vulnerability Reporting as
  the disclosure channel; 3-business-day ack; 90-day coordinated
  disclosure window.
- **`SUPPORTED.md`** added — package-by-package compat matrix + the
  6-month deprecation policy + MCP-schema-fields-never-removed rule.
- **`CONTRIBUTING.md`** rewritten — Node 22 / pnpm 9.14.4 dev setup,
  DCO mandatory with the repo's `harry-harish` git identity called out,
  no-`pull_request_target` hard rule citing PostHog Shai-Hulud 2.0
  (Nov 24 2025), workflow-permissions hard rule, integration cap
  forward-reference to this doc.
- **`CODE_OF_CONDUCT.md`** contact updated to GitHub PVR (the same
  channel as security disclosure).
- **`renovate.json`** added — 7-day default cooldown, 21-day cooldown
  for the `@posthog/rrweb-*` lineage, `pinDigests: true` for all
  GitHub Actions, patch-auto-merge for survivors, `vulnerabilityAlerts`
  bypasses cooldown.
- **`pnpm-workspace.yaml`** — `minimumReleaseAge: 10080` (7 days in
  minutes). Inert under the current pnpm 9.14.4 pin (the setting is
  pnpm 10.16+) but declared now so a future pnpm bump is one line; the
  cooldown is enforced by Renovate in the meantime.
- **`.github/workflows/ci.yml`** + **`release.yml`** — workflow-root
  `permissions: contents: read` defaults; every action pinned to a
  40-character commit SHA with a `# v<tag>` comment.
- **`.github/workflows/scorecard.yml`** added — OpenSSF Scorecard
  weekly read-only scan; SARIF upload to GitHub code scanning;
  non-blocking.
- **`NOTICE` audit** — root `NOTICE` expanded to enumerate every
  MIT-licensed dep shipped in any published package; new
  `packages/peek-extension/NOTICE` added (the CWS bundle ships the
  rrweb-recorder.js IIFE which carries upstream rrweb MIT-licensed
  code; not previously covered).
- **`docs/peek/THREATMODEL.md`** + **`docs/tracelane/THREATMODEL.md`**
  added as stubs — surfaces enumerated, mitigations sketched, the gap
  is now visible rather than implicit.

The principle behind the batch: the cost of these controls in 2026 is
two days; the cost of being un-hardened the day a Shai-Hulud-class
attack hits is the project. We do the cheap part now.

## Source

- `prds/shared-preamble.md` §4 "Side-project framing and sustainability"
- `prds/IMPLEMENTATION_PLAN.md` Task 4.6
- Tracking issue for second-maintainer recruitment: https://github.com/Cubenest/rrweb-stack/issues/9
- OSS Maintenance Field Manual (one of the four research docs informing
  the Phase 5 launch plan)
