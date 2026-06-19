# peek Claude Code Skill — standalone install recipe

If you want the peek Claude Code skill *without* running `npx @peekdev/cli init` (you don't want the native messaging host installed, you don't want anything written to your MCP client configs, you just want the skill so Claude Code knows when peek's MCP tools are useful), use this recipe.

## One-liner

```sh
mkdir -p ~/.claude/skills/peek && \
curl -fsSL https://raw.githubusercontent.com/Cubenest/rrweb-stack/main/packages/peek-cli/skills/peek-skill.md \
  -o ~/.claude/skills/peek/SKILL.md
```

That's it. Open Claude Code and the skill is live on next session start. Verify:

```sh
ls -l ~/.claude/skills/peek/SKILL.md
# should show the file, ~6 KB
```

## What it does

Claude Code auto-loads `SKILL.md` files from `~/.claude/skills/<name>/SKILL.md` on session start. The peek skill's frontmatter tells Claude *when* to invoke peek (recent browser sessions, errors from manual repros, "what did the user do before X", DOM-at-time queries, Playwright test generation from a session). The body documents the 14 MCP tools, the standard workflow, the per-origin permission model, and example flows.

It does NOT include the MCP server itself — you still need `@peekdev/mcp` configured in `~/.claude.json` for Claude Code to be able to call the tools. The skill teaches *when*; the MCP server provides *what*.

If you want both in one shot:

```sh
npx @peekdev/cli init
```

…and let the wizard handle both wiring steps. Pass `--skip-native-host` if you only want the MCP config + the skill (no Chrome extension setup yet).

## Updating

Peek's skill content moves with the package. To pull the latest:

```sh
curl -fsSL https://raw.githubusercontent.com/Cubenest/rrweb-stack/main/packages/peek-cli/skills/peek-skill.md \
  -o ~/.claude/skills/peek/SKILL.md
```

`peek init` does the same thing idempotently — running it on a machine that already has the skill is a no-op (writes nothing if the file matches the bundled source).

## Removing

Just delete the directory:

```sh
rm -rf ~/.claude/skills/peek
```

`peek init` will not re-create it as long as Claude Code is not in the selected clients list AND `~/.claude.json` does not exist.

## Source

Canonical skill content lives in this repo at `packages/peek-cli/skills/peek-skill.md`. PRs welcome — if you've spotted a way peek should be invoked that the skill doesn't surface, open an issue with the example query.
