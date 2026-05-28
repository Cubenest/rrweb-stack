---
"@cubenest/rrweb-core": patch
---

Fix: relative imports now carry `.js` extensions so the package resolves cleanly under bare Node / NodeNext ESM. The previous `0.1.0-alpha.0` shipped with extensionless imports and would fail at runtime when consumed by NodeNext downstream packages.
