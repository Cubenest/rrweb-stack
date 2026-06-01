# peek-docs recipe hero images

Drop the recipe hero screenshots here. Each **published** recipe embeds one
hero image near the top of its body as:

```md
![alt text](/recipes/assets/<slug>.png)
```

That path is served from this directory (`apps/peek-docs/public/recipes/assets/`).
Until the real screenshots land, the recipe verifier
(`packages/docs-shared/scripts/verify-recipes.mjs`) prints a loud
`⚠ MISSING HERO IMAGE` warning per file but stays non-fatal. Once every file
below is present, CI can flip `STRICT_RECIPE_ASSETS=1` to make a missing hero
image a hard build failure.

## Expected files (one per published recipe)

| File | Recipe |
|---|---|
| `claude-code-on-staging.png` | Let Claude Code reproduce a bug on authenticated staging |
| `generate-playwright-repro-from-real-browser-session.png` | Generate a Playwright repro from a real browser session |
| `let-cursor-see-real-network-calls.png` | Let Cursor see real network calls |
| `security-review-flow-with-ai-agent.png` | Security-review a flow with an AI agent |
| `set-up-peek-with-claude-code.png` | Set up peek with Claude Code |
| `set-up-peek-with-cline-windsurf-codex.png` | Set up peek with Cline / Windsurf / Codex |
| `set-up-peek-with-cursor.png` | Set up peek with Cursor |
| `use-peek-with-per-action-approval.png` | Understand peek's per-action approval model |

Draft recipes also reference `<slug>.png` images, but the verifier only
enforces the published set above (drafts are excluded from production builds).

## Recommended dimensions

- **1600 × 900 px** (16:9), PNG. The recipe prose column renders at ~760 px,
  so 1600 px wide keeps it crisp on retina/2x displays.
- Keep each file under ~500 KB; compress PNGs (e.g. `pngquant`/`oxipng`) before
  committing.
