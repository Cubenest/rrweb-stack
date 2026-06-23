# peek — distribution submission queue

Submission metadata for the registries peek targets.

**Order matters — submit the official MCP Registry FIRST** (row 1). It is the
canonical, upstream source of truth. The downstream registries (Smithery,
PulseMCP, mcp.so) do **NOT** auto-ingest from it — verified 2026-06-02 against the
registry docs + the validator source; the earlier "publish once → feeds all
downstream" assumption was wrong — so each still needs its own separate submission.

The public launch is out (see `_context/docs/PHASE_5_LAUNCH_PLAN.md` + the
post-launch ordering doc), so these are cleared to submit.

**Row 1 is DONE.** The official MCP Registry submission landed 2026-06-02 —
`@peekdev/mcp` now carries the required `mcpName` (`io.github.Cubenest/peek-mcp`)
and the registry lists it as `active`. Verify any time with:

```sh
curl "https://registry.modelcontextprotocol.io/v0/servers?search=peek-mcp"
```

The downstream rows (Smithery, PulseMCP, mcp.so) are the remaining open work.

## Targets

| Target | File | Mechanism | Lead time |
|---|---|---|---|
| **[Official MCP Registry](https://registry.modelcontextprotocol.io/)** — canonical, submitted first | [`packages/peek-mcp/server.json`](../../../packages/peek-mcp/server.json) + [`modelcontextprotocol-servers.md`](./modelcontextprotocol-servers.md) | `mcp-publisher` CLI + `server.json`; **requires `mcpName` in the published npm package** | **DONE 2026-06-02** (active) |
| [Smithery](https://smithery.ai) | [`smithery.json`](./smithery.json) | `smithery.yaml` PR or upload via dashboard | ~1 day |
| [PulseMCP](https://www.pulsemcp.com) | [`pulsemcp.json`](./pulsemcp.json) | Auto-scrape (npm `mcp` keyword) + manual submission form | ~1 day (auto) / ~3 days (manual review) |
| [mcp.so](https://mcp.so) | [`mcp-so.md`](./mcp-so.md) | Markdown blurb / PR | ~1 day |

> The retired `modelcontextprotocol/servers` "Community Servers" PR target is gone
> (Anthropic redirected third-party discovery to the official registry in the
> Dec-2025 migration). [`modelcontextprotocol-servers.md`](./modelcontextprotocol-servers.md)
> now documents the official-registry flow; don't PR to that repo's README.

## Submission checklist

Execute in this order:

1. **Verify the npm scope.** Confirm `@peekdev/mcp` and `@peekdev/cli` are
   published and `npm view @peekdev/mcp version` returns the expected alpha tag.
   The extension stays `private: true` (not published to npm). peek is now
   available on the [Chrome Web Store](https://chromewebstore.google.com/detail/peek/dmgpmkeneheenpdnfmpjjahnkknkaejb);
   the unpacked build remains the contributor/local-build path.
2. **Confirm the repo is public.** `gh repo view Cubenest/rrweb-stack --json
   visibility --jq .visibility` should be `PUBLIC`. The privacy policy + permission
   justification + this README reference repo URLs that must resolve for reviewers.
3. **Chrome Web Store — submitted + live.** peek is now available on the
   [Chrome Web Store](https://chromewebstore.google.com/detail/peek/dmgpmkeneheenpdnfmpjjahnkknkaejb)
   (live since 2026-06-21). This was the long-pole; the registry copy references
   the CWS URL. The downstream registry submissions can now reference the live listing.
4. **Official MCP Registry (canonical) — DONE 2026-06-02.** `@peekdev/mcp`
   shipped the required `mcpName` and the registry lists `io.github.Cubenest/peek-mcp`
   as `active`. Confirm it's still live before relying on it downstream:
   ```sh
   npm view @peekdev/mcp mcpName                   # → io.github.Cubenest/peek-mcp
   curl "https://registry.modelcontextprotocol.io/v0/servers?search=peek-mcp"
   ```
   To re-publish (e.g. to bump the listed version), bump `version` in
   `packages/peek-mcp/server.json` to a published npm version, then:
   ```sh
   cd packages/peek-mcp
   mcp-publisher login github     # interactive; or `login github-oidc` in CI
   mcp-publisher publish          # reads the committed ./server.json
   ```
   Full detail + the ownership mechanism: [`modelcontextprotocol-servers.md`](./modelcontextprotocol-servers.md).
5. **Then submit the downstream registries SEPARATELY** (they do NOT auto-ingest):
   - **Smithery** — upload `smithery.yaml` per [`smithery.json`](./smithery.json);
     cross-check field names against the live Smithery schema docs.
   - **PulseMCP** — fill the form from [`pulsemcp.json`](./pulsemcp.json); its
     auto-scrape may have already picked up `@peekdev/mcp` from npm — confirm before
     submitting the manual form to avoid duplicates.
   - **mcp.so** — submit via mcp.so's current flow with the blurb from [`mcp-so.md`](./mcp-so.md).
6. **Check each listing 48 h after submission.** Record the listing URL here as it
   lands so we can link them from the repo README.

## Cross-links

- [Privacy policy](../PRIVACY_POLICY.md) — source of truth for the data-handling
  claims every registry's copy depends on.
- [Permission justification](../PERMISSION_JUSTIFICATION.md) — Chrome Web Store
  submission text; the registry copy links out to the now-live
  [Chrome listing](https://chromewebstore.google.com/detail/peek/dmgpmkeneheenpdnfmpjjahnkknkaejb).
- Distribution strategy: `_context/docs/research/tracelane-peek-distribution.md`
  (maintainer-private companion repo) — the parent doc that defines why these
  (and *only* these — it anti-lists Cypress Cloud / Sentry Session Replay /
  Highlight.io as integrations NOT to pursue).
