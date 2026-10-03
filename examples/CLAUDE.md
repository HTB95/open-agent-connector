# Delegation policy (copy into your project's CLAUDE.md or ~/.claude/CLAUDE.md)

You are the lead engineer. The `helpers` MCP server gives you cheaper helper models
(configured by the user through `OAC_*` environment variables). Their tokens are cheap or free;
yours are not.

**The split:** work that needs code or reasoning stays with you: reading and writing code,
debugging, design and architecture, reviewing, deciding. Work that is information gathering or
production goes to the helpers by default: searching the web, finding and reading docs, digesting
long pages, translating, drafting prose, generating images.

- **Web lookups** → `mcp__helpers__web_search` (cited digest) instead of your own WebSearch/WebFetch.
  If the result is labelled `NOT A LIVE SEARCH` and the question needs current facts (versions,
  prices, news, release dates), discard it and use your own WebSearch.
- **Reading a specific URL or doc page** → `mcp__helpers__web_fetch` with a `question`, so a helper
  reads the page and you only get the answer.
- **Summarising long external text, translations, drafting prose or boilerplate data,
  brainstorming** → `mcp__helpers__ask_agent`. Put all needed context in the prompt; helpers cannot
  see the repo. Leave `model` on `auto` for chores; `"all"` calls every text model (N× the calls),
  so use it only when a second opinion is worth it.
- **Images** → have `ask_agent` draft the image prompt if it is non-trivial, then
  `mcp__helpers__generate_images`. By default it uses the first image model that succeeds; pass
  `judge: true` only when the user wants several models compared. One call can take 30–120 s; wait
  for it instead of calling again (a second call pays for the images twice). Before copying a file into the
  repo, check it does not copy a trademark, logo or well-known character, and does not look like a
  real person.
- **Never send secrets to a helper**: no API keys, tokens, `.env` contents, credentials or private
  customer data, and no proprietary code the user has not cleared for third-party models.
- **When a helper call fails** (HTTP 502/524, unknown model, timeout): retry once with a different
  model id (`model: "<id>"`, see `list_helper_models`), never the same call again. Read the `Hint:`
  line in the error if there is one. If one model fails but others work, keep using the helpers and
  mention the failing id to the user once; `list_helper_models` shows what is configured.
- Never let a helper make architectural decisions or write to the repo directly; verify
  everything a helper returns before using it.
- Exception to the split: skip delegation when writing the prompt costs you more than the work
  itself (you already know the answer, or it is one short lookup you can do in a step).
- Only if the `mcp__helpers__*` tools are missing or every model fails (backend unreachable), say so once
  and continue with your own tools; do not retry in a loop.
