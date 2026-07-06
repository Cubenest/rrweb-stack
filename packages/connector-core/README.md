# @peekdev/connector-core

Surface- and brain-agnostic runtime for peek chat connectors: `ConnectorRuntime`,
the `SurfaceAdapter` / `Brain` interfaces, `SdkBrain`, the stdio peek MCP client
(`PeekMcp`), and session state. A connector = a `SurfaceAdapter` (e.g. Slack) +
this runtime + a `Brain` + an MCP client that spawns `@peekdev/mcp`.

> Private/unpublished (alpha). Run connectors via their own package (e.g.
> `@peekdev/connector-slack`).

## LLM configuration (`PEEK_LLM_*`)

`SdkBrain` speaks the **Anthropic Messages API** via `@anthropic-ai/sdk`, so the
`baseURL` may point at any Anthropic-API-compatible endpoint.

| env | required | notes |
|-----|----------|-------|
| `PEEK_LLM_API_KEY` | yes | provider key (or any non-empty string for a local endpoint) |
| `PEEK_LLM_BASE_URL` | no | unset = native Anthropic; set = a compatible gateway/endpoint |
| `PEEK_LLM_MODEL` | no | defaults to Claude; set any model the endpoint exposes |

Works today with: **Anthropic native** (leave `PEEK_LLM_BASE_URL` unset),
**OpenRouter** (`PEEK_LLM_BASE_URL=https://openrouter.ai/api`, model e.g.
`openai/gpt-4o`), and **local models** (below).

## Local model (experimental, keyless)

Running a local model keeps peek's **reasoning on your machine — no cloud LLM.**
Cloud (BYO key) is the default; local is an opt-in.

> **Local-first: peek uploads nothing — what your connector and its LLM do with
> the data is up to you.** A local model keeps the reasoning + your raw peek tool
> results on-device; a cloud model (or the chat platform your connector bridges
> to) receives whatever you send it.

1. Install [Ollama](https://ollama.com) **≥ 0.14** (it natively serves the
   Anthropic Messages API at `http://localhost:11434`).
2. Pull a **tool-capable** model (e.g. `qwen3`, `granite4`, `llama3.3`,
   `gemma3`; prefer a ≥ 32K-context model for agentic loops):
   `ollama pull qwen3`
3. Configure the connector:
   ```sh
   PEEK_LLM_BASE_URL=http://localhost:11434
   PEEK_LLM_API_KEY=ollama          # any non-empty string; unvalidated locally
   PEEK_LLM_MODEL=qwen3
   ```

**Honest tradeoff:** with a local model, your raw peek tool results (masked DOM /
session summaries / errors), tool schemas, and the model's reasoning stay
on-device rather than going to a cloud model provider — the connector still
exchanges your messages and its replies with your chat platform. The cost is
**slower** responses and **weaker multi-turn** tool-chaining than a frontier
cloud model; small local models can mis-call or malform tool calls. Treat local
as experimental and verify against your real workflow.

**Notes / guardrails:**
- `tool_choice.disable_parallel_tool_use` is a no-op locally (Ollama lists
  `tool_choice` unsupported); `SdkBrain` enforces "at most one action per turn"
  in its own loop regardless, so this is safe.
- Do **not** add a token-count call against a local base URL —
  `/v1/messages/count_tokens` is unsupported and can hang Ollama. `SdkBrain`
  only calls `messages.create`; keep it that way.
- Ollama's Anthropic-compat surface is young/version-dependent — pin/verify your
  Ollama version.
