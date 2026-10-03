# Contributing

Thanks for your interest! Issues and pull requests are welcome.

## Ground rules

- **Zero runtime dependencies.** The connector must keep running with `npx -y github:…`. Nothing
  may require `npm install`. Use only the Node.js (≥ 18.17) standard library.
- **Not tied to a backend.** Code should rely only on OpenAI-compatible endpoints. Anything specific
  to one gateway (such as native search or fetch) must be opt-in and configured through `OAC_*`
  variables.
- **Protect Claude's context.** Every tool result goes through `clip()` and
  `OAC_MAX_RESULT_CHARS`. Keep tool schemas short, because they are re-sent on every turn.
- **No secrets in generated files.** `init` must only write `${VAR}` references.

## Development

```bash
npm test                      # node:test against a mock gateway (test/mock-router.mjs)
npm run doctor -- --text      # optional live probe using your own OAC_* env
```

- Add or update tests for every behaviour change. New backend shapes go into the mock.
- Document new settings in the README configuration table.

## Project conventions

- **CHANGELOG.md:** newest entry first. Explain *why* a change was made, not only what changed.
  Never edit past entries.
- **`@SecondBrain` comments:** exported symbols carry a doc block with `@Description` and
  `@History: [YYYY-MM-DD HH] [Action] - [Why]`. Add a history line when you change a symbol.
  Don't rewrite old lines.
- Code, comments and identifiers are in English.

## Pull requests

1. Fork, then create a feature branch.
2. Make sure `npm test` passes.
3. Describe the change and the motivation. Link the related issue if there is one.
