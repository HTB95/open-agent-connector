# Changelog

Newest first. Each entry records WHY, not just WHAT. Past entries are never edited.

## [Unreleased]

### Repository
- The repository is now public. The development branch `claude/admiring-fermi-j85p6m` has been
  deleted, and `main` is the only branch.
  WHY: this finishes the public release. The owner deleted the branch and changed the visibility
  in the GitHub UI, because the cloud session cannot change repository settings or delete refs.
  Verified: `npx -y github:HTB95/open-agent-connector` started from a clean npm cache and answered
  MCP `initialize` (open-agent-connector 0.4.0) and `tools/list` with all five tools.
- `main` is now the default branch. The development branch `claude/admiring-fermi-j85p6m` is
  being removed, so the line below about history staying there no longer holds once it is gone.
  WHY: GitHub visibility is per repository, not per branch. Making the repo public would also
  publish every other branch, so the owner chose to keep only `main` and drop the development
  history. Projects that ran `init --ref claude/admiring-fermi-j85p6m` must run `init` again
  without `--ref`.
- Added a `main` branch as one squashed commit of the 0.4.0 tree. The full development history
  stays on the `claude/admiring-fermi-j85p6m` branch.
  WHY: the owner wants a clean default branch for the public release. The early history holds
  Vietnamese drafts that were specific to the author's 9router setup, and a new contributor does
  not need it.
- Privacy audit before going public: searched the tree, every historical blob and every commit
  message. No API keys, email addresses, IP addresses, local file paths or screenshots were found.
  What remains public on purpose: the GitHub handle `HTB95` (repo URL, LICENSE, package author)
  and a localhost port mentioned in past changelog entries, which are never edited.

## [0.4.0] - 2026-10-03

### Changed (BREAKING)
- The connector no longer depends on any particular backend. It works with any
  OpenAI-compatible gateway or provider (9router, LiteLLM, OpenRouter, OpenAI, Ollama, …).
  WHY: preparing the open-source release. 9router was only the author's own setup, and other
  users should be able to bring whatever backend they already run.
- Every environment variable now uses the `OAC_` prefix, and the vendor-specific roles were
  replaced by plain model-id lists:

  | Old (≤ 0.3.0) | New (0.4.0) |
  |---|---|
  | `NINEROUTER_BASE_URL` | `OAC_BASE_URL` (now required, no default) |
  | `NINEROUTER_API_KEY` | `OAC_API_KEY` |
  | `ANTIGRAVITY_TEXT_MODEL`, `CODEX_TEXT_MODEL`, `AUTO_ORDER` | `OAC_TEXT_MODELS` (ordered list = failover order) |
  | `CODEX_IMAGE_MODELS`, `ANTIGRAVITY_IMAGE_MODEL` | `OAC_IMAGE_MODELS` |
  | `JUDGE_MODEL` | `OAC_JUDGE_MODEL` |
  | `SEARCH_PROVIDERS` (default `antigravity,searxng`) | `OAC_SEARCH_PROVIDERS` (default empty) + `OAC_SEARCH_PATH` |
  | Codex Responses `web_search` (implicit) | `OAC_SEARCH_MODEL` (opt-in) |
  | `FETCH_PROVIDERS` | `OAC_FETCH_PROVIDERS` + `OAC_FETCH_PATH` |
  | `IMAGE_OUT_DIR`, `MAX_RESULT_CHARS`, `MAX_INLINE_IMAGE_BYTES`, `TEXT_TIMEOUT_MS`, `IMAGE_TIMEOUT_MS` | same names with the `OAC_` prefix |

  WHY: generic names such as `IMAGE_OUT_DIR` can clash with other tools in a shared shell, and a
  fixed codex/antigravity pair cannot describe "any number of models from any vendor".
  The old variables are not read any more. A silent fallback would hide a half-migrated setup.
- Tool parameters were renamed:
  - `ask_agent.agent` (`auto|codex|antigravity|both`) is now `ask_agent.model` (`auto|all|<model id>`).
  - `generate_images.providers` / `n_per_provider` are now `models` / `n_per_model`.

  WHY: the parameters now refer to whatever the user configured, not to two hard-coded vendors.
- `OAC_BASE_URL` has no default. If it is unset, the error message explains how to set it.
  WHY: the old default `localhost:12121` was the author's personal 9router port and wrong for
  everyone else. Failing loudly beats calling the wrong host.
- Native search and fetch endpoints are now opt-in. `web_search` with no live route configured
  returns an answer labelled `NOT A LIVE SEARCH` that says no route is configured.
  WHY: `/search` and `/web/fetch` are 9router extensions, not part of the OpenAI API.
- Image parameters `quality`, `background` and `output_format` are sent based on the model name
  (`gpt-image`, `gpt-…-image`, `dall-e`), and `response_format` is no longer sent to `gpt-image-*`.
  WHY: the previous "Codex only" switch only made sense for one gateway. OpenAI documents
  `response_format` as unsupported for gpt-image models.
- Text-model auto-discovery now uses one generic heuristic: the first id from `/models` that is
  not an image, audio or embedding model. It replaces the per-vendor regex tables.
  WHY: gateways name models arbitrarily, and explicit `OAC_TEXT_MODELS` is the recommended setup.
- `doctor` uses vendor-neutral probes (a Node.js LTS question and example.com) and exits with
  code 1 when a probe fails.
  WHY: it can now be scripted, and its probes no longer assume 9router.

### Added
- The README, `docs/SETUP.md`, `examples/` and the server instructions were rewritten in English
  for open source, with backend examples. Added `CONTRIBUTING.md`, `SECURITY.md`, a GitHub
  Actions test matrix (Node 18/20/22), and package metadata (`repository`, `keywords`, `files`).
  WHY: user asked for standard open-source documentation.
- Tests for model auto-pick, a chat-only backend, a missing base URL and image-parameter
  filtering (21 total, all against the mock gateway).

### Migration
Rename your variables using the table above, list your models explicitly, then run
`npx -y github:HTB95/open-agent-connector init` again in each project to refresh `.mcp.json` and
the `CLAUDE.md` policy. For example, the previous 9router setup becomes:
`OAC_BASE_URL=http://localhost:12121/v1`, `OAC_TEXT_MODELS=ag/gemini-3.5-flash-medium,cx/gpt-5.5`,
`OAC_IMAGE_MODELS=cx/gpt-image-2.5,ag/gemini-3.1-flash-image`, `OAC_SEARCH_PROVIDERS=antigravity`,
`OAC_SEARCH_MODEL=cx/gpt-5.5`.

### Verified
- `npm test`: 21/21 pass against the mock gateway. Nothing in this release was run against a real
  backend. Use `doctor` to check yours.

## [0.3.0] - 2026-10-03

### Added
- `init` subcommand (`npx -y github:HTB95/open-agent-connector init`): writes `.mcp.json` with
  `${VAR}` expansion and no secrets, pre-approves the server via `enabledMcpjsonServers` in
  `.claude/settings.json`, upserts the delegation policy between markers in `CLAUDE.md`, and
  ignores `.generated-images/`.
  WHY: user wants the same setup for local and cloud Claude Code, and wants new sessions to use
  the helpers without re-explaining. A committed .mcp.json and CLAUDE.md is the one config both
  environments load automatically.
- `doctor` is also a subcommand of the main bin, so nothing needs cloning.
- `docs/SETUP.md`: local / cloud (tunnel, environment variables, network allowlist) / Claude
  Desktop setup and how to brief Claude in another session.
  WHY: cloud sessions cannot reach localhost or Tailscale. The 9router tunnel and an env-var
  setup are required and non-obvious.
- Policy line: if helpers are unavailable, say so once and continue.
  WHY: avoid wasting Claude tokens on retry loops when 9router is down.

### Verified
- `npx -y github:HTB95/open-agent-connector#claude/admiring-fermi-j85p6m` answered an MCP
  `initialize` from a cloud container. 19 tests pass (mock router). There is still no live call
  against the user's real 9router.

## [0.2.0] - 2026-10-03

### Changed
- `web_search` now calls 9router's native `POST /v1/search` with `SEARCH_PROVIDERS`
  (default `antigravity,searxng`) before falling back to Codex Responses `web_search`.
  WHY: user asked to prefer Antigravity for web search. Their dashboard shows Antigravity connected
  under Web Search, and 9router runs it as free Google Search grounding.
- Codex images now go straight to `POST /v1/images/generations` with `CODEX_IMAGE_MODELS`
  (default `cx/gpt-image-2.5`, optionally `cx/gpt-5.6-luna-image`). The Responses
  `image_generation` path was removed.
  WHY: the user's dashboard exposes cx/ image models directly on the images endpoint. One call
  means fewer ways to fail.
- Image requests send `Accept: application/json`, and background/output_format were added for Codex.
  WHY: 9router streams image responses as SSE when Accept contains text/event-stream (seen in the
  user's dashboard curl and in the 9router source). The connector needs a single JSON body.
- Default base URL is now `http://localhost:12121/v1`.
  WHY: the user's 9router listens on 12121, not the upstream default 20128.

### Added
- Tool `web_fetch`: content comes from 9router `/v1/web/fetch` (`FETCH_PROVIDERS`) or a local
  fetch. With `question`, an Antigravity-first helper digests the page.
  WHY: 9router has no Antigravity fetch provider, so "Antigravity first" here means Antigravity
  reads the page and Claude only receives the answer.
- Tests for the search fallback chain, web_fetch and multi-model Codex images (15 total, mock router).

## [0.1.0] - 2026-10-03

### Added
- Zero-dependency stdio MCP server (`bin/server.mjs`, `src/mcp-server.mjs`).
  WHY: user wants Claude to remain the lead/orchestrator while free Codex (ChatGPT Plus) and
  Antigravity (Google AI Pro) accounts do chores. An MCP server is the only integration where
  Claude decides *when* helpers are called; pointing Claude Code at 9router directly would
  replace Claude itself. Hand-rolled protocol avoids `npm install` friction.
- 9router as the single backend (`src/router-client.mjs`).
  WHY: user already connected both accounts to 9router; it handles OAuth refresh, quota and
  format translation, so the connector stays thin and provider-agnostic.
- Model auto-discovery from `GET /v1/models` (`src/models.mjs`).
  WHY: 9router model ids change between releases; hard-coding one id would break silently.
- Tool `ask_agent` (auto failover / both-in-parallel) and `web_search` (Codex Responses
  `web_search` with citations, loudly-labelled non-live fallback).
  WHY: search and long-text digestion are the biggest Claude-token sinks; helpers return a
  compact digest capped by `MAX_RESULT_CHARS`.
- Tool `generate_images`: Codex (gpt-image via Responses `image_generation`, fallback to
  `/v1/images/generations`) and Antigravity (Gemini image via `/v1/images/generations`) in
  parallel; review modes `paths` / `judge` / `inline`.
  WHY: user's headline request — both helpers draw, Claude picks the best. `judge` lets a free
  vision model pre-rank so Claude reads a few lines instead of viewing every image.
- `npm run doctor` smoke test, `examples/mcp.json`, `examples/CLAUDE.md` delegation policy.
  WHY: debug the real 9router setup at zero Claude-token cost, and tell Claude *when* to
  delegate (without a policy Claude rarely calls helper tools).
- Test suite (13 tests, `node:test`) against a mock 9router, incl. stdio end-to-end.
  WHY: verify protocol + failover paths without real accounts; live verification is left to
  `npm run doctor` on the user's machine (not run in CI — no real 9router there).
