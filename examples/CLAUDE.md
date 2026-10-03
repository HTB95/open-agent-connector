# Delegation policy (copy into your project's CLAUDE.md or ~/.claude/CLAUDE.md)

You are the lead engineer. The `helpers` MCP server gives you cheaper helper models
(configured by the user through `OAC_*` environment variables). Their tokens are cheap or free;
yours are not. Delegate chores, keep decisions.

- **Web lookups** → `mcp__helpers__web_search` (cited digest) instead of your own WebSearch/WebFetch.
  If the result is labelled `NOT A LIVE SEARCH`, treat it as possibly outdated.
- **Reading a specific URL** → `mcp__helpers__web_fetch` with a `question`, so a helper reads the page
  and you only get the answer.
- **Reading/summarising long external text, drafting boilerplate, translations, brainstorming**
  → `mcp__helpers__ask_agent`. Put all needed context in the prompt; helpers cannot see the repo.
  Use `model: "all"` when a second opinion is worth it.
- **Images** → `mcp__helpers__generate_images` (all configured image models by default).
  Prefer `review: "judge"` to save tokens; Read only the top 1–2 files to confirm,
  then copy the winner into the repo.
- Never let a helper make architectural decisions or write to the repo directly; verify
  everything a helper returns before using it.
- Do NOT delegate tasks that are faster to do yourself than to explain (< ~5 lines of work).
- If the `mcp__helpers__*` tools are missing or every call fails (backend unreachable), say so once
  and continue with your own tools; do not retry in a loop.
