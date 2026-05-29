# tracelane — threat model (DRAFT)

**Status:** stub. To be filled in before the first `1.0` release of any
`@tracelane/*` package. Existence-tracking only — the gap is intentionally
visible.

**Owner:** harry-harish.

This file enumerates the attack surfaces and existing / outstanding
mitigations for `@tracelane/core`, `@tracelane/report`, and
`@tracelane/wdio`. It is referenced from
[`docs/PHASE_5_LAUNCH_PLAN.md`](../PHASE_5_LAUNCH_PLAN.md) Gate A and from
[`SECURITY.md`](../../SECURITY.md).

When this stub is replaced, follow the format described in the OSS
Maintenance Field Manual §5.3 — one surface per row in each table,
explicit grade (`mitigated` / `partial` / `accepted` / `open`), and a
"why we live with it" column for any accepted risk.

## Attack surfaces to cover

1. **In-page rrweb recorder IIFE injection** — `@tracelane/wdio` injects
   the recorder bundle via `browser.execute`. The bundle runs in the
   page's own JS context and reads DOM + console + network. Trust
   boundary: page → test runner process.
2. **HTML report file** — `@tracelane/report` emits a self-contained
   `.html` that embeds the rrweb player, the gzipped event blob, and
   anything captured (DOM mutations, console args, network bodies if
   the recorder captured them). The file is shared as a CI artifact
   or attached to a test report. Trust boundary: anyone with the
   report URL.
3. **Embedded `rrweb-player`** — UMD bundle inlined into the report
   HTML. A future compromise of upstream `rrweb-player` would land in
   every report generated after that version bump.
4. **Console / network argument leakage** — `console.log(secret)` in a
   test will end up in the report unless the masker strips it. Trust
   boundary: test code → report consumer.
5. **WDIO service injection point** — `@tracelane/wdio`'s service hook
   runs in the WDIO runner process with full Node access. Trust
   boundary: WDIO runner → host system.
6. **CI artifact retention** — reports are typically uploaded to GitHub
   Actions / GitLab CI artifacts; the retention policy is the consumer's
   responsibility. Trust boundary: us → CI provider.
7. **Vendored `@posthog/rrweb` fork** — the recorder substrate. A future
   upstream PostHog compromise would affect us only on a deliberate
   `@cubenest/rrweb-core` bump (we pin); but the *narrative* risk is
   real because everyone reads "uses rrweb" and assumes mainline.

## Mitigations already in place

- `@cubenest/rrweb-core` pins `@posthog/rrweb@0.0.34` exactly; no semver
  range, no auto-bump.
- `@tracelane/wdio` recorder is bundled as an IIFE at build time; the
  in-page surface is one closure-scoped export, not `import`-able.
- Masking config is opt-in but documented; default config strips
  password / email / autocomplete fields and uses `maskTextSelector`
  to hide test-data placeholders.
- Self-contained HTML report design: no remote font / asset / CDN —
  if you can open the file on a desktop with no network, the report
  is fully functional. Eliminates an entire class of report-time
  exfiltration.
- Apache-2.0 + NOTICE propagation for the embedded rrweb-player +
  rrweb fork — see `packages/tracelane-report/NOTICE` and
  `packages/tracelane-wdio/NOTICE`.
- Renovate cooldown (`renovate.json`): 21 days for `@posthog/rrweb-*`
  bumps; rejects same-day Shai-Hulud-class compromises.

## Outstanding mitigations

- **Report-file PII review surface** — there is no in-tool way for a
  user to preview what is in the report before sharing it. A "redact
  before share" CLI mode would be valuable; deferred to post-1.0.
- **Console argument depth-cap** — `console.log(deeplyNestedObject)`
  can put a lot of bytes in the report; we have a size cap in the
  recorder but not a structure-depth cap. Pre-1.0 scope.
- **Network body capture (off by default)** — when enabled by users
  who need it for debugging, body capture is unconstrained beyond
  the size cap. Need an explicit allowlist mode where the user
  declares which response patterns are safe to capture (e.g. only
  application/json from a specific host).
- **CI-artifact retention guidance** — README should explicitly call
  out that reports can contain sensitive page content and recommend
  short retention (≤ 7 days for any public CI artifact). Documentation
  task, pre-launch.
- **`@posthog/rrweb` divergence audit** — periodic re-diff of our
  vendored fork against upstream PostHog mainline; once per quarter
  or when a security advisory lands on upstream.

## Cross-references

- [`docs/SECURITY-NOTES.md`](../SECURITY-NOTES.md)
- [`SECURITY.md`](../../SECURITY.md)
- [`docs/PHASE_5_LAUNCH_PLAN.md`](../PHASE_5_LAUNCH_PLAN.md) Gate A
- `packages/tracelane-wdio/NOTICE`
- `packages/tracelane-report/NOTICE`
