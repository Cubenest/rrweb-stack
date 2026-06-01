# tracelane-docs recipe hero images

Drop the recipe hero screenshots here. Each **published** recipe embeds one
hero image near the top of its body as:

```md
![alt text](/recipes/assets/<slug>.png)
```

That path is served from this directory (`apps/tracelane-docs/public/recipes/assets/`).
Until the real screenshots land, the recipe verifier
(`packages/docs-shared/scripts/verify-recipes.mjs`) prints a loud
`⚠ MISSING HERO IMAGE` warning per file but stays non-fatal. Once every file
below is present, CI can flip `STRICT_RECIPE_ASSETS=1` to make a missing hero
image a hard build failure.

## Expected files (one per published recipe)

| File | Recipe |
|---|---|
| `add-tracelane-to-webdriverio-in-5-minutes.png` | Add tracelane to WebdriverIO in 5 minutes |
| `catch-visual-regression-across-test-run.png` | Catch a visual regression across a test run |
| `debug-flaky-checkout-test-in-ci.png` | Debug a flaky checkout test in CI |
| `reproduce-headless-only-failure-locally.png` | Reproduce a headless-only failure locally |
| `share-failing-test-with-a-developer.png` | Share a failing test with a developer |
| `triage-ci-run-with-replay-thumbnails.png` | Triage a CI run with replay thumbnails |

Draft recipes also reference `<slug>.png` images, but the verifier only
enforces the published set above (drafts are excluded from production builds).

## Recommended dimensions

- **1600 × 900 px** (16:9), PNG. The recipe prose column renders at ~760 px,
  so 1600 px wide keeps it crisp on retina/2x displays.
- Keep each file under ~500 KB; compress PNGs (e.g. `pngquant`/`oxipng`) before
  committing.
