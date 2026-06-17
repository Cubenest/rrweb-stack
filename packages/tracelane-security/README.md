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

Apache-2.0.
