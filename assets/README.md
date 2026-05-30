# assets/

Hero images, GIFs, and other static media referenced from the per-package READMEs.

Generated artifacts (`.gif`, `.png`, `.webm`) **are committed**. The sources used to produce them (`.tape` for vhs, `.scenes` for ScreenStudio) live alongside so future-you can re-record after a UI change.

## Files

| File | Used by | How to regenerate |
|---|---|---|
| `tracelane-hero.tape` | `packages/tracelane-wdio/README.md` (hero GIF) | see "Recording tracelane-hero.gif" below |
| `tracelane-hero.gif` | same | same |
| `record-tracelane-hero.sh` | (driver script) | invoked manually; see below |
| `peek-hero.tape` | `packages/peek-cli/README.md` (hero GIF) | see "Recording peek-hero.gif" below |
| `peek-hero.gif` | same | same |
| `record-peek-hero.sh` | (driver script) | invoked manually; see below |

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

## Recording `peek-hero.gif`

The GIF demonstrates the read side of peek: a recorded browser session appears as a queryable structured artifact your AI agent (or you, via the CLI) can drill into. Shows `peek sessions list` → `peek sessions show ... --format markdown` → `... --format json`. The install half (`npx peek init`) is covered in the README install code block; the init wizard is interactive (multiSelect prompts) and doesn't record cleanly in 15 seconds.

Target: under 15 seconds, under 6 MB (Gate B1). The current take is ~660 KB.

```sh
# 1. Install vhs + sqlite3 (sqlite3 ships preinstalled on macOS).
brew install vhs

# 2. Run the driver. It builds @peekdev/cli from the monorepo, seeds three
#    synthetic sessions in a /tmp fixture sessions.db, then invokes vhs.
bash assets/record-peek-hero.sh

# 3. Verify size + duration.
ls -lh assets/peek-hero.gif
# Target: under 6 MB, under 15 seconds.

# 4. Commit + push.
git add assets/peek-hero.gif
git commit -s -m "chore(assets): re-record peek hero GIF"
git push origin main

# 5. The hero is already referenced from packages/peek-cli/README.md via
#    https://raw.githubusercontent.com/Cubenest/rrweb-stack/main/assets/peek-hero.gif
#    so a fresh `.gif` flows through the CDN within a few minutes.
```

Why a fixture sessions.db: the maintainer's real `~/.peek/sessions.db` contains private browsing history. The driver script never touches it — it sets `HOME=/tmp/peek-hero-demo` for the vhs run and seeds `$HOME/.peek/sessions.db` from scratch each time. The three seeded sessions (a `shop.example.com` checkout with a 404, a `localhost:3000/dashboard` with a React TypeError, and a clean GitHub read) are intentionally generic.

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
