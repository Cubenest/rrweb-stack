---
"@peekdev/cli": minor
---

peek: explicit, configurable session retention

New `peek retention` command bounds the local store without ever deleting
silently. Configure a policy (`set --max-age <dur> --max-size <size> --keep <n>`),
see exactly what would be removed (`preview`), then prune (`apply`, with a
confirmation unless `--yes`). Pruning is age- and/or disk-based with an absolute
"keep the last N most-recent" floor, never removes an active (in-progress)
recording (unless you pass `--include-stale-active` for crashed sessions), and
frees the on-disk event blobs. `peek status` now reports total store size and how
much is over your policy. Local-only; no telemetry.
