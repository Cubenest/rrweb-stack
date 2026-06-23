# @peekdev/todomvc-demo

A modern TodoMVC, rebuilt by an AI coding agent from a [peek](https://peek.cubenest.in)-captured browser session — not from a screenshot. The agent worked off the real DOM peek recorded while a human used the original [todomvc.com](https://todomvc.com), then reimplemented it with a fresh UI while keeping the original flow.

This is the live artifact behind the "[Clone a web app with peek](https://peek.cubenest.in/recipes/clone-a-web-app-with-peek)" recipe. It is **not published to npm** — it's a private workspace app bundled into the peek docs site and served at [peek.cubenest.in/demo](https://peek.cubenest.in/demo).

## What it shows

- React 19 + Vite + Tailwind v4 + Framer Motion, shadcn-style UI.
- Dark mode, drag-to-reorder, double-click-to-edit.
- Keyboard shortcuts: `/` focuses the add-todo input; `1` / `2` / `3` switch the all / active / completed filters.

## Develop

From the repo root:

```sh
pnpm --filter @peekdev/todomvc-demo dev      # Vite dev server
pnpm --filter @peekdev/todomvc-demo build    # type-check + production build → dist/
pnpm --filter @peekdev/todomvc-demo preview  # preview the production build
```

The `base` path is controlled by the `VITE_BASE` env var (`/` by default). The peek docs build sets `VITE_BASE=/demo/` and copies `dist/` into `apps/peek-docs/public/demo` — see [`apps/peek-docs/scripts/bundle-demo.mjs`](../peek-docs/scripts/bundle-demo.mjs).

## About peek

peek is a browser companion for AI coding agents. It records masked browser sessions to a local SQLite store (`~/.peek`) and exposes them to coding agents through a stdio MCP server — entirely local, no telemetry, no cloud. The agents can read past sessions (summaries, console/network errors, DOM history, Playwright repros) and, with explicit per-origin consent, drive a live page. Docs: [peek.cubenest.in](https://peek.cubenest.in). Source: [Cubenest/rrweb-stack](https://github.com/Cubenest/rrweb-stack).

Apache-2.0.
