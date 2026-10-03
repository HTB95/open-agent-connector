# open-agent-connector

[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Node.js >= 18.17](https://img.shields.io/badge/node-%3E%3D18.17-brightgreen.svg)](package.json)
[![Dependencies: 0](https://img.shields.io/badge/dependencies-0-success.svg)](package.json)
[![MCP](https://img.shields.io/badge/MCP-stdio-purple.svg)](https://modelcontextprotocol.io)

**Keep Claude as the lead engineer and hand the chores to cheaper models.**

`open-agent-connector` is a zero-dependency [MCP](https://modelcontextprotocol.io) server. It gives
Claude (Claude Code, Claude Desktop) a small set of tools that hand work to **helper models behind
any OpenAI-compatible endpoint**: web search, page reading, text drafting and image generation.
Claude decides when to delegate, checks what comes back, and makes every final call. The helpers
spend their tokens and Claude saves its own.

```
          ┌──────────────────────────────────────┐
  You ──▶ │ Claude (lead: plans, decides, codes) │
          └───────────────────┬──────────────────┘
                              │ MCP over stdio (Claude chooses when to call)
          ┌───────────────────▼──────────────────┐
          │ open-agent-connector (this repo)     │  Node.js, zero dependencies
          └───────────────────┬──────────────────┘
                              │ HTTPS + Bearer key, OpenAI-compatible API
          ┌───────────────────▼──────────────────┐
          │ Any gateway / provider               │  9router · LiteLLM · OpenRouter ·
          │ /chat/completions  /images/...       │  OpenAI · Ollama · …
          └──────────────────────────────────────┘
```

## Why

- **Claude stays in charge.** If you point Claude Code's base URL at another model, Claude is gone.
  With an MCP server, Claude keeps the controls and only calls helpers when it decides to.
- **Fewer Claude tokens.** Helpers read the long pages, search results and drafts. Claude only gets
  a short digest, capped by `OAC_MAX_RESULT_CHARS`.
- **Several image models compete.** One brief goes to every image model you configured, in
  parallel. Claude picks the best result, or a cheap vision model ranks them first.
- **Not tied to a backend.** It talks standard OpenAI endpoints. Models are plain ids from your
  config, so you can mix vendors behind one gateway.
- **Nothing to install.** Run it with `npx -y github:HTB95/open-agent-connector`. It has no
  dependencies and no build step.

## Tools exposed to Claude

| Tool | What it does | Backend calls |
|---|---|---|
| `ask_agent` | Hands a self-contained text task to a helper. `model: "auto"` tries `OAC_TEXT_MODELS` in order and moves to the next on failure. `"all"` runs every model in parallel so Claude can compare. You can also pass an exact model id. | `POST /chat/completions` |
| `web_search` | Runs a live search and returns a short answer with source URLs. | Native search endpoint (opt-in) → Responses API `web_search` tool (opt-in) → if both are unavailable, an answer from model knowledge, clearly labelled `⚠️ NOT A LIVE SEARCH` |
| `web_fetch` | Reads a URL. If you pass `question`, a helper reads the whole page and Claude gets only the answer. | Native fetch endpoint (opt-in), otherwise a local fetch, then `POST /chat/completions` |
| `generate_images` | Sends one brief to every model in `OAC_IMAGE_MODELS` in parallel and saves every candidate to disk. | `POST /images/generations` (+ `/chat/completions` for `review: "judge"`) |
| `list_helper_models` | Shows the configured roles and the model ids the backend advertises. | `GET /models` |

The `review` option of `generate_images` controls how Claude sees the candidates:

- `paths` (default): you get file paths, and Claude opens the ones it wants with its Read tool.
- `judge`: a vision-capable helper scores the candidates first, so Claude reads a short ranking. This is the cheapest option.
- `inline`: the images are embedded in the tool result. This uses the most tokens.

## Quick start

Requirements: **Node.js ≥ 18.17**, **git**, and an OpenAI-compatible endpoint with an API key.

```bash
# 1. Point the connector at your backend (example: OpenAI directly)
export OAC_BASE_URL="https://api.openai.com/v1"
export OAC_API_KEY="sk-..."
export OAC_TEXT_MODELS="gpt-5-mini"
export OAC_IMAGE_MODELS="gpt-image-1"
export OAC_SEARCH_MODEL="gpt-5-mini"

# 2. Smoke-test the backend outside Claude (costs no Claude tokens)
npx -y github:HTB95/open-agent-connector doctor --text --search --fetch --image

# 3. Wire a project (writes .mcp.json, .claude/settings.json, CLAUDE.md, .gitignore)
cd your-project
npx -y github:HTB95/open-agent-connector init
git add -A && git commit -m "Wire Claude helpers"
```

Restart Claude Code and run `/mcp`. You should see `helpers · connected`. Then try:

> Create a hero image for a coffee-shop landing page using all helper image models, review with
> judge, and copy the best one to `public/hero.png`.

For per-user install, Claude Code on the web (cloud), Claude Desktop and troubleshooting, see
**[docs/SETUP.md](docs/SETUP.md)**.

## Configuration

All settings are environment variables. `init` writes a `.mcp.json` that forwards them with
`${VAR:-}` expansion, so **the file never contains a secret**.

| Variable | Default | Description |
|---|---|---|
| `OAC_BASE_URL` | **required** | OpenAI-compatible base URL, including `/v1` (for example `http://localhost:4000/v1`). |
| `OAC_API_KEY` | _(empty)_ | Sent as `Authorization: Bearer …`. Leave empty for backends without auth. |
| `OAC_TEXT_MODELS` | auto-pick | Comma-separated chat model ids. `ask_agent auto` and page digests try them in this order and fail over to the next. If empty, the first id from `GET /models` that doesn't look like an image, audio or embedding model is used. |
| `OAC_IMAGE_MODELS` | _(empty)_ | Comma-separated image model ids. All of them draw in parallel. `generate_images` stays disabled until this is set. |
| `OAC_JUDGE_MODEL` | first text model | Vision-capable chat model used by `review: "judge"`. |
| `OAC_SEARCH_PROVIDERS` | _(empty)_ | Provider ids for a **native** search endpoint (`POST {base}/search` with `{model, query, max_results}`), tried in order. Example: 9router's `antigravity`. |
| `OAC_SEARCH_PATH` | `/search` | Path of that native search endpoint. |
| `OAC_SEARCH_MODEL` | _(empty)_ | A model that supports the OpenAI **Responses API** `web_search` tool. Used after the native providers. |
| `OAC_FETCH_PROVIDERS` | _(empty)_ | Provider ids for a **native** fetch endpoint (`POST {base}/web/fetch` with `{model, url, format}`). If empty, pages are fetched locally. |
| `OAC_FETCH_PATH` | `/web/fetch` | Path of that native fetch endpoint. |
| `OAC_IMAGE_OUT_DIR` | `$TMPDIR/open-agent-connector/images` | Where candidate images are saved. `init` sets `.generated-images` inside the project. |
| `OAC_MAX_RESULT_CHARS` | `12000` | Maximum characters any tool returns to Claude. |
| `OAC_MAX_INLINE_IMAGE_BYTES` | `1500000` | Larger images are never inlined. |
| `OAC_TEXT_TIMEOUT_MS` / `OAC_IMAGE_TIMEOUT_MS` | `120000` / `240000` | HTTP timeouts. |

Notes:

- The image parameters `quality`, `background` and `output_format` are sent only to OpenAI-style
  image models: ids containing `gpt-image`, `gpt-…-image` or `dall-e`. Other models get `prompt`,
  `size` and `n`. `response_format: "b64_json"` is left out for `gpt-image-*` models, because
  OpenAI documents it as unsupported there.
- Claude Code gives MCP tools a limited time to run. Image generation can take 30–120 s, so set
  `MCP_TOOL_TIMEOUT=300000` in the environment that launches Claude Code.

## Backend examples

These are example settings. Check yours with `doctor` before you rely on them.

<details open>
<summary><b>LiteLLM proxy</b>: many vendors behind one endpoint</summary>

```bash
OAC_BASE_URL=http://localhost:4000/v1
OAC_API_KEY=sk-litellm-master-or-virtual-key
OAC_TEXT_MODELS=gemini-flash,gpt-mini          # model_name values from your config.yaml
OAC_IMAGE_MODELS=gpt-image,imagen
OAC_SEARCH_MODEL=gpt-mini                       # only if that deployment supports Responses web_search
```
</details>

<details>
<summary><b>9router</b>: also has native search and fetch endpoints</summary>

```bash
OAC_BASE_URL=http://localhost:20128/v1          # use the port your dashboard shows
OAC_API_KEY=sk-...
OAC_TEXT_MODELS=ag/gemini-3.5-flash-medium,cx/gpt-5.5
OAC_IMAGE_MODELS=cx/gpt-image-2.5,ag/gemini-3.1-flash-image
OAC_SEARCH_PROVIDERS=antigravity                # 9router POST /v1/search
OAC_SEARCH_MODEL=cx/gpt-5.5                     # fallback: Responses web_search
OAC_FETCH_PROVIDERS=jina-reader                 # optional, only if connected in 9router
```
</details>

<details>
<summary><b>OpenAI</b></summary>

```bash
OAC_BASE_URL=https://api.openai.com/v1
OAC_API_KEY=sk-...
OAC_TEXT_MODELS=gpt-5-mini
OAC_IMAGE_MODELS=gpt-image-1
OAC_SEARCH_MODEL=gpt-5-mini
```
</details>

<details>
<summary><b>OpenRouter</b>: text helpers</summary>

```bash
OAC_BASE_URL=https://openrouter.ai/api/v1
OAC_API_KEY=sk-or-...
OAC_TEXT_MODELS=google/gemini-2.5-flash,openai/gpt-5-mini
```
`generate_images` needs an OpenAI-style `/images/generations` endpoint. Leave `OAC_IMAGE_MODELS`
empty here unless your gateway provides one.
</details>

<details>
<summary><b>Ollama</b>: local models</summary>

```bash
OAC_BASE_URL=http://localhost:11434/v1
OAC_TEXT_MODELS=qwen3:8b
```
</details>

> If you use a gateway that pools consumer subscriptions, it is up to you to follow each provider's
> terms of service.

## How the token savings work

1. **Digest, don't dump.** `web_search` and `web_fetch` with `question` return a short answer, not
   the raw page.
2. **Hard cap.** Every tool result is cut at `OAC_MAX_RESULT_CHARS`, with a note that it was cut.
3. **Cheap judging.** `review: "judge"` turns N images into a few lines of text, so Claude doesn't
   have to view each image.
4. **A delegation policy.** `init` adds a short policy to `CLAUDE.md` telling Claude *when* to
   delegate. Without one, Claude rarely calls helper tools on its own.
5. **Small tool surface.** Five tools with short schemas, because tool definitions are re-sent on
   every turn.

## Security

- **Don't commit keys.** Keys belong in your shell profile or in the cloud environment settings.
  `.mcp.json` only holds `${VAR}` references.
- If your gateway is reachable from the internet, put it behind **HTTPS** and require an API key.
  Without TLS, the bearer key travels as plain text.
- Helpers never touch your repository. They only see what Claude puts in a prompt.
- See [SECURITY.md](SECURITY.md) to report a vulnerability.

## Limitations

- Only the stdio transport is supported. The claude.ai web chat (remote MCP connectors) is not.
- The automated tests run against a **mock** gateway (`test/mock-router.mjs`), not real providers.
  Use `doctor` to check your own backend.
- Native search and fetch endpoints are not part of the OpenAI API. They follow the request and
  response shape used by 9router, and the paths can be changed.

## Development

```bash
git clone https://github.com/HTB95/open-agent-connector.git
cd open-agent-connector
npm test                      # node:test, no install needed
npm run doctor -- --text      # live probe using your OAC_* env
```

Project layout:

```
bin/server.mjs        CLI entry: MCP server (default), `init`, `doctor`
src/mcp-server.mjs    hand-rolled MCP JSON-RPC over stdio
src/router-client.mjs OpenAI-compatible HTTP client (JSON + SSE tolerant)
src/models.mjs        role resolution / text-model auto-pick
src/tools/*.mjs       ask_agent, web_search, web_fetch, generate_images, list_helper_models
src/init.mjs          project wiring for Claude Code
examples/             delegation policy + sample .mcp.json
test/                 node:test suites + mock gateway
```

Contributions are welcome. Read [CONTRIBUTING.md](CONTRIBUTING.md) first.

## License

[MIT](LICENSE)
