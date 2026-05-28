# peek — distribution submission queue

Pre-filled submission metadata for the four MCP registries peek targets.
All four are **DRAFT — DO NOT SUBMIT** until Phase 5 launch (per the
distribution strategy at
[`/docs/tracelence-peek-dev-distribution.md`](../../tracelence-peek-dev-distribution.md)
which holds these for "public launch timing").

## Targets

| Target | File | Mechanism | Lead time |
|---|---|---|---|
| [Smithery](https://smithery.ai) | [`smithery.json`](./smithery.json) | `smithery.yaml` PR or upload via dashboard | ~1 day |
| [PulseMCP](https://www.pulsemcp.com) | [`pulsemcp.json`](./pulsemcp.json) | Auto-scrape (npm `mcp` keyword) + manual submission form | ~1 day (auto) / ~3 days (manual review) |
| [mcp.so](https://mcp.so) | [`mcp-so.md`](./mcp-so.md) | Markdown blurb / PR | ~1 day |
| [modelcontextprotocol/servers](https://github.com/modelcontextprotocol/servers) | [`modelcontextprotocol-servers.md`](./modelcontextprotocol-servers.md) | PR to repo `README.md` | ~3-7 days (maintainer review) |

## Phase 5 launch checklist

Execute in this order when the public-launch trigger fires (per the
distribution doc's day-90 thresholds):

1. **Verify the npm scope.** Confirm `@peekdev/mcp` and `@peekdev/cli` are
   published and `npm view @peekdev/mcp version` returns the expected
   alpha/beta tag. The extension stays `private: true` (loaded unpacked
   until the CWS listing is live).
2. **Confirm the repo is public.** `gh repo view Cubenest/rrweb-stack
   --json visibility --jq .visibility` should be `PUBLIC`. The privacy
   policy + permission justification + this README all reference repo
   URLs that must resolve for reviewers.
3. **Submit Chrome Web Store first.** The 3-7 day review window is the
   long-pole. The four MCP registries below all reference the CWS URL in
   their copy — wait until the listing exists (even if pending review)
   before queuing the four.
4. **Submit MCP registries in parallel:**
   - **Smithery** — upload `smithery.yaml` per
     [`smithery.json`](./smithery.json); cross-check field names against
     the live Smithery schema docs.
   - **PulseMCP** — fill the submission form from
     [`pulsemcp.json`](./pulsemcp.json); PulseMCP's auto-scrape may have
     already picked up `@peekdev/mcp` from npm — confirm before submitting
     the manual form to avoid duplicates.
   - **mcp.so** — submit via mcp.so's current submission flow with the
     blurb from [`mcp-so.md`](./mcp-so.md).
   - **modelcontextprotocol/servers** — fork + PR per
     [`modelcontextprotocol-servers.md`](./modelcontextprotocol-servers.md).
5. **Check each listing 48 h after submission.** Each registry has a
   slightly different review path; record the listing URL in this
   checklist as it lands so we can link them from the repo README.

## Cross-links

- [Privacy policy](../PRIVACY_POLICY.md) — the source of truth for the
  data-handling claims every registry's copy depends on.
- [Permission justification](../PERMISSION_JUSTIFICATION.md) — Chrome Web
  Store submission text; the four MCP registries above link out to the
  Chrome listing once it's live.
- [Distribution strategy](../../tracelence-peek-dev-distribution.md) — the
  parent doc that defines why these four (and *only* these four — the
  doc explicitly anti-lists Cypress-Cloud / Sentry-Session-Replay /
  Highlight as integrations NOT to pursue).
