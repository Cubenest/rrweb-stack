# @tracelane/security

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
