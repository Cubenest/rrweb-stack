---
"@cubenest/rrweb-core": patch
"@tracelane/cli": patch
"@tracelane/core": patch
"@tracelane/playwright": patch
"@tracelane/report": patch
"@tracelane/wdio": patch
---

Raise `engines.node` to `>=22` for the shared substrate and the tracelane
packages, matching the monorepo root (`>=22.0.0`), `SUPPORTED.md` (which already
lists all of these as **Node 22+**), and the dev setup documented in
`CONTRIBUTING.md`.

Unlike `@peekdev/*` — where Node 22 is a hard requirement because `better-sqlite3`
only ships prebuilt binaries for Node 22+ — tracelane and `@cubenest/rrweb-core`
have no native dependency and run on Node 20. This bump is a **support-baseline
alignment**, not a technical necessity: it makes every published package's
`engines` field agree with the support matrix instead of lagging at the old
`>=20.18.0`, and formally drops Node 20 from the supported set while the project
is still pre-1.0 alpha. The tracelane docs recipes were updated to state
**Node >= 22** to match.
