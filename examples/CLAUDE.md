# Delegation policy (copy into your project's CLAUDE.md or ~/.claude/CLAUDE.md)

You are the lead engineer. The `helpers` MCP server gives you cheaper helper models
(configured by the user through `OAC_*` environment variables). Their tokens are cheap or free;
yours are not. Delegate chores, keep decisions.

- **Web lookups** → `mcp__helpers__web_search` (cited digest) instead of your own WebSearch/WebFetch.
  If the result is labelled `NOT A LIVE SEARCH` and the question needs current facts (versions,
  prices, news, release dates), discard it and use your own WebSearch.
- **Reading a specific URL** → `mcp__helpers__web_fetch` with a `question`, so a helper reads the page
  and you only get the answer.
- **Reading/summarising long external text, drafting boilerplate, translations, brainstorming**
  → `mcp__helpers__ask_agent`. Put all needed context in the prompt; helpers cannot see the repo.
  Use `model: "all"` when a second opinion is worth it.
- **Images** → have `ask_agent` draft the image prompt if it is non-trivial, then
  `mcp__helpers__generate_images` with `review: "judge"`. Read only the top 1–2 files. Before
  copying the winner into the repo, check it does not copy a trademark, logo or well-known
  character, and does not look like a real person.
- **Never send secrets to a helper**: no API keys, tokens, `.env` contents, credentials or private
  customer data, and no proprietary code the user has not cleared for third-party models.
- **When a helper call fails** (HTTP 502/524, unknown model, timeout): retry once with a different
  model id (`model: "<id>"`, see `list_helper_models`), never the same call again. Read the `Hint:`
  line in the error if there is one.
- Never let a helper make architectural decisions or write to the repo directly; verify
  everything a helper returns before using it.
- Do NOT delegate tasks that are faster to do yourself than to explain (< ~5 lines of work).
- If the `mcp__helpers__*` tools are missing or every call fails (backend unreachable), say so once
  and continue with your own tools; do not retry in a loop.
