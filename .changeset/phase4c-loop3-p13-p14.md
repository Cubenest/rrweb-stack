---
"@peekdev/cli": patch
"@peekdev/extension": patch
---

Phase 4c QA loop #3 — two targeted fixes from the maintainer's alpha.3 walk:

- **P-13** (`@peekdev/cli`): `peek init` is now idempotent. Before prompting
  for the unpacked extension ID, it reads the first existing native-host
  manifest's `allowed_origins`, extracts any previously-saved dev ID via the
  new `extractDevId()` helper, and offers to reuse it. Decline falls through
  to the original prompt. Confirms B.4 idempotency of the Phase 4c QA
  checklist.
- **P-14** (`@peekdev/extension`): the `debugger` permission moved from
  `optional_permissions` to required `permissions`. Chrome 121+ banned
  `debugger` from MV3 optional permissions; the entry was silently dropped
  at load, breaking Deep capture (Group H) at install. The install card now
  shows the read-and-modify-all-data warning; per-origin Deep capture
  control via the side-panel toggle (ADR-0010) is unchanged.

`@peekdev/extension` stays `private: true` — the manifest fix ships only to
maintainers who rebuild locally and load unpacked. CWS submission remains
Phase 5.
