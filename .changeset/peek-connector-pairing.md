---
"@peekdev/extension": patch
"@peekdev/mcp": patch
---

peek: connector pairing / attestation (SP4)

Connectors now pair with peek via a matching-code trust-dial handshake: the
service worker mints a secret, stores only its hash (chrome.storage.local), and
returns the plaintext once. The connector presents the secret on each action;
the SW verifies it, and the Level-3 banner-less delegated-consent path now
requires a verified paired connector — closing the forge-the-flag gap that a
bare consentDelegated flag left open. Destructive actions still force the local
banner; TOCTOU revalidation still applies; delegation never escalates below
Level 3; direct clients are unaffected. Pairings are revocable on the trust
dial. No new egress.
