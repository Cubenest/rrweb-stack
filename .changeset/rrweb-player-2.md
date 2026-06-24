---
"@tracelane/report": minor
---

Update the bundled rrweb-player to 2.0.1 (from 1.0.0-alpha.4).

rrweb-player 2.x changed its package `exports` map — the old `dist/index.js`
path and `package.json` are no longer resolvable — so the report's UMD inliner
now resolves the bare entry and reads the sibling `dist/rrweb-player.umd.min.cjs`
(which sets the `window.rrwebPlayer` global, unlike the bare CJS entry). The
self-contained report still inlines the player UMD + CSS for fully offline
viewing; no API change.
