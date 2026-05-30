---
"@peekdev/cli": patch
---

Embed peek hero GIF at the top of the @peekdev/cli npm landing page.

Closes the Gate B1 peek hero requirement from launch plan §3.2 (Week
3-4). Hero shows the read side of peek's value: a recorded browser
session as queryable, structured output. The 15-second flow:

  $ peek sessions list
  → 3 recent sessions (shop.example.com checkout, localhost:3000
    dashboard, github.com docs read) with error counts

  $ peek sessions show s_demo_checkout --format markdown
  → markdown summary with console errors (Stripe.js loaded twice +
    404 from /api/checkout/confirm), network errors (404 + 500),
    and the indirect-virality attribution footer

  $ peek sessions show s_demo_checkout --format json | head -28
  → JSON envelope with the top-level `_attribution` block

The install half (`npx peek init`) is covered in the README install
code block; the wizard's interactive multiSelect prompts don't record
cleanly in vhs inside the 15-second budget.

Asset is ~660 KB (under the 6 MB Gate B1 ceiling). 1200x720, no
narration, no Claude Code chat UI -- terminal-only.

Scaffolding shipped alongside (in `assets/`):

- `peek-hero.tape` -- the vhs script
- `record-peek-hero.sh` -- driver that builds @peekdev/cli from the
  monorepo, seeds three synthetic sessions in a /tmp fixture
  sessions.db (never touches the maintainer's real ~/.peek), and
  invokes vhs. Re-records are one command.

Root README also picks up the peek GIF alongside tracelane's, replacing
the "peek's equivalent hero GIF lands in a future launch motion chunk"
placeholder text.

Docs only; no @peekdev/cli code change. Patch bump lands the embedded
image on the npm landing page.
