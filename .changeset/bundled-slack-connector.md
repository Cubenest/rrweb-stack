---
"@peekdev/cli": minor
---

peek connect: the Slack connector now ships pre-bundled inside the CLI, so
`peek connect add slack` works with no monorepo clone and no `--local` build.

`pnpm build` bundles `@peekdev/connector-slack` (from source, with
`@peekdev/connector-core` aliased to source too) into
`dist/connectors/slack.js` via esbuild. The slack descriptor now spawns that
bundle with the same Node binary running the CLI. The native keychain module
`@napi-rs/keyring` is the only external — it is now a runtime dependency of
`@peekdev/cli`, so npm installs its platform binary and the bundle resolves it
at spawn time (tokens still go to the OS keychain).

End-to-end setup drops to: `npm i -g @peekdev/cli && peek connect add slack &&
peek connect start`.
