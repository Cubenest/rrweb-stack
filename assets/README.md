# assets/

Hero images, GIFs, and other static media referenced from the per-package READMEs.

Generated artifacts (`.gif`, `.png`, `.webm`) **are committed**. The sources used to produce them (`.tape` for vhs, `.scenes` for ScreenStudio) live alongside so future-you can re-record after a UI change.

## Files

| File | Used by | How to regenerate |
|---|---|---|
| `tracelane-hero.tape` | `packages/tracelane-wdio/README.md` (hero GIF) | see "Recording tracelane-hero.gif" below |
| `tracelane-hero.gif` (committed once recorded) | same | same |

`peek-hero.tape` + `peek-hero.gif` land in Week 3-4 per `docs/PHASE_5_LAUNCH_PLAN.md` row 3-4.

## Recording `tracelane-hero.gif`

The GIF demonstrates install-to-first-value: install the package, run the suite, see the report-written line. Target: under 15 seconds, under 6 MB (Gate B1).

```sh
# 1. Install vhs locally (one-time)
brew install vhs

# 2. Stage a fixture project at /tmp/tracelane-hero-demo
#    A clean WDIO project with @tracelane/wdio in devDeps + a deliberately
#    failing spec. See the comment block at the top of tracelane-hero.tape
#    for the exact npm init + install commands.
mkdir -p /tmp/tracelane-hero-demo
cd /tmp/tracelane-hero-demo
# ... (see tape file)

# 3. Record (run from inside the fixture; output lands in rrweb-stack/assets/)
cd /tmp/tracelane-hero-demo
vhs /path/to/rrweb-stack/assets/tracelane-hero.tape

# 4. Verify size + duration
ls -lh /path/to/rrweb-stack/assets/tracelane-hero.gif
# Target: under 6 MB, under 15 seconds. If oversized, lower FontSize or trim Sleeps.

# 5. Commit the .gif (NOT the fixture project) to rrweb-stack
cd /path/to/rrweb-stack
git add assets/tracelane-hero.gif
git commit -s -m "chore(assets): record tracelane hero GIF for npm + GitHub README"
git push origin main

# 6. Add the GIF reference to packages/tracelane-wdio/README.md right above the
#    install code block:
#
#    ![tracelane in action](https://raw.githubusercontent.com/Cubenest/rrweb-stack/main/assets/tracelane-hero.gif)
#
#    Use the absolute raw.githubusercontent URL — npm doesn't render
#    relative image paths from package READMEs.
```

## Conventions

- **Filenames are kebab-case**, lowercased, with the product name prefixed (`tracelane-hero.gif`, `peek-mcp-demo.gif`, not `hero.gif`).
- **Hero GIFs are under 6 MB and 15 seconds.** Hard ceiling. Anything longer is a video, not a hero — link to YouTube or the docs page instead.
- **No narration overlay** on hero GIFs. The reader is reading; visual + the README copy carry the story. Narrated assets belong in docs or product videos.
- **Use the absolute `raw.githubusercontent.com` URL** when referencing assets from per-package READMEs — npm doesn't honor relative paths into the repo from a package subdirectory.
- **No third-party hotlinks** for hero assets. Commit every asset locally; rotating CDNs is a maintenance burden and a broken link in alpha-2026 looks worse than no image.

## Per-product responsibility

`tracelane-*.gif/.png` — referenced from `packages/tracelane-*/README.md` only.
`peek-*.gif/.png` — referenced from `packages/peek-*/README.md` only.
`rrweb-stack-*` — the top-level README only.

This keeps npm package downloads small: only files referenced from a package's own README get pulled by `npm pack`.
