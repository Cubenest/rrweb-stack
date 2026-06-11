---
title: "Surface security-hygiene signals on failed tests"
lede: "When my e2e suite already drives the real app, I want OWASP-aligned hygiene notes to fall out of the run I already have — not a separate scanner to wire up."
description: "Read advisory security-hygiene signals — missing headers, insecure cookies, mixed content, reverse tabnabbing — straight from your failed-test tracelane report."
type: hero
status: draft
publishedAt: 2026-06-15
integrations: [webdriverio, security]
artifact: /demo/security-hygiene-advisory.html
relatedRecipes: [add-tracelane-to-webdriverio-in-5-minutes, share-failing-test-with-a-developer, debug-flaky-checkout-test-in-ci]
---

## What you'll end up with

A collapsed **"Security hygiene (advisory)"** panel inside the same `tracelane-report-<spec>.html` your suite already writes on a failure — plus a `## Security hygiene (advisory)` section in the report's Copy-as-Markdown-for-AI output, so the findings travel with the failure when you paste it into a coding agent. No extra scan, no second tool, no new CI step.

![Tracelane advisory security panel](/recipes/assets/surface-security-hygiene-on-failed-tests.png)

[See a real report](/demo/security-hygiene-advisory.html) — open it and expand the "Security hygiene (advisory)" panel.

This is an **advisory** layer, not a security audit or a scanner. It surfaces a handful of low-false-positive hygiene signals that the run already captured for free; treat it as a hint, not a verdict.

## Prerequisites

- An existing WebdriverIO project running `@tracelane/wdio`
- Node >= 22

## Steps

### 1. It's already on

The advisory security layer ships inside the WDIO service and is **on by default**. If you already have tracelane writing reports, you have it:

```bash
npm i -D @tracelane/wdio
```

```ts
import { tracelaneService } from '@tracelane/wdio';

export const config = {
  services: [tracelaneService()],
  // ... your existing config
};
```

The signals are derived from the rrweb DOM snapshot, console, and network stream tracelane already captures — there's nothing extra to capture or configure.

### 2. Read the panel

Open the report on a failure and expand the collapsed **"Security hygiene (advisory)"** panel. Each finding lists the signal and the evidence (e.g. a header that was absent on an HTTPS response, or an anchor with `target="_blank"` and no `rel="noopener"`). The same findings appear under `## Security hygiene (advisory)` when you click **Copy as Markdown for AI**.

### 3. Disable it (optional)

If you don't want the panel, turn it off in the service options:

```ts
services: [tracelaneService({ security: false })],
```

### 4. Suppress individual findings (optional)

To keep the layer on but silence known/accepted findings, drop a `tracelane.security.suppress.json` in your project root:

```json
{
  "suppressions": [
    { "signal": "insecure-cookie", "evidence": "session" }
  ]
}
```

Matching findings are dropped from both the panel and the Markdown output.

## What it flags

- **Missing security headers** — CSP, HSTS, X-Frame-Options, X-Content-Type-Options, Referrer-Policy. **HTTPS pages only** (gated to avoid localhost noise). _Needs the CDP network path (see below)._
- **Insecure cookies** — missing `Secure` / `HttpOnly` / `SameSite`. Any scheme. _Needs the CDP network path (see below)._
- **Mixed content** — an `http://` subresource on an `https` page. **HTTPS pages only**, read from the rrweb DOM snapshot — works on any browser.
- **Reverse tabnabbing** — `target="_blank"` links without `rel="noopener"`. Any scheme, read from the DOM — works on any browser.

> **Header + cookie signals need response metadata**, which tracelane reads over the Chrome DevTools Protocol — the same optional CDP enrichment that powers authoritative network status. On a CDP-capable session (Chromium with the devtools/CDP network path active) all four signals light up; without it, tracelane degrades gracefully and you still get the two **DOM-derived** signals (mixed content, reverse tabnabbing). The mixed-content and tabnabbing checks never need CDP.

## Why this works

The signals are derived from the rrweb DOM snapshot, console events, and network responses tracelane **already captures** on a failing test — so the panel costs zero extra capture and no extra CI time. It's deliberately **advisory and low-false-positive**: it's a hygiene hint that rides along with a failure you were already debugging, not a security audit or vulnerability scan. Header and mixed-content checks are HTTPS-gated so a localhost fixture doesn't drown you in noise.

On privacy: capture records header **names** and cookie **flag booleans** only — never header values or cookie values. The advisory layer never sees secrets.

## Next steps

- [Add tracelane to WebdriverIO in 5 minutes](/recipes/add-tracelane-to-webdriverio-in-5-minutes)
- [Share a failing test with a developer](/recipes/share-failing-test-with-a-developer)
- [Debug a flaky checkout test in CI](/recipes/debug-flaky-checkout-test-in-ci)
