<img src="https://raw.githubusercontent.com/Cubenest/rrweb-stack/main/assets/brand/sub-tracelane.svg" height="40" alt="tracelane">

# @tracelane/security

[![CI](https://github.com/Cubenest/rrweb-stack/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/Cubenest/rrweb-stack/actions/workflows/ci.yml)
[![OpenSSF Scorecard](https://api.scorecard.dev/projects/github.com/Cubenest/rrweb-stack/badge)](https://scorecard.dev/viewer/?uri=github.com/Cubenest/rrweb-stack)
[![license](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](https://github.com/Cubenest/rrweb-stack/blob/main/LICENSE)
![status: alpha](https://img.shields.io/badge/status-alpha-orange.svg)

Advisory, low-false-positive security-hygiene signals derived from a captured
rrweb + console + network event stream. It turns what a test run already
observed (response headers, mixed content, cookie flags, `target=_blank`
links) into a small set of human-readable findings.

This is a pure-analysis package: it reads a captured event stream and returns
findings. It performs no network requests and mutates no state.

**Advisory only — this is not a security audit.** Findings are hygiene hints,
not authoritative vulnerability results, and absence of findings does not imply
the application is secure.

## What it detects

Advisory hygiene signals derived from the captured stream:

- **Missing security headers** — e.g. a `Content-Security-Policy` or
  `Strict-Transport-Security` header that was never observed on a response.
- **Insecure cookie flags** — `Set-Cookie` lacking `Secure`, `HttpOnly`, or
  `SameSite`.
- **Mixed content** — an `http://` resource referenced from an HTTPS page.
- **Reverse tabnabbing** — `target="_blank"` links without `rel="noopener"`.

**Privacy:** findings record header/cookie-flag *presence* only — never header
values or cookie values. See the [security notes](https://github.com/Cubenest/rrweb-stack/blob/main/docs/SECURITY-NOTES.md)
for the full threat model.

## Distribution

This package is **not published to npm** — it is private (`private: true`).
The analyzer is vendored into [`@tracelane/report`](https://github.com/Cubenest/rrweb-stack/blob/main/packages/tracelane-report/README.md)
at build time and wired in automatically by the tracelane reporters
(`@tracelane/wdio`, `@tracelane/playwright`). It runs by default; disable it
with `security: false` in the reporter/service options. To silence specific
findings while leaving the layer on, drop a `tracelane.security.suppress.json`
file in the project root — the reporters load it at report-write time and pass
the rules to the analyzer.

See the [CHANGELOG](https://github.com/Cubenest/rrweb-stack/blob/main/packages/tracelane-security/CHANGELOG.md).

Apache-2.0.
