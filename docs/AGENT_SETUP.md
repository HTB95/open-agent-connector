# Setup runbook for Claude

This page is written for **Claude** (or any coding agent) to follow when a user asks it to set up
open-agent-connector in a project. A user can start it with one message:

> Set up open-agent-connector in this project by following
> https://github.com/HTB95/open-agent-connector/blob/main/docs/AGENT_SETUP.md

Humans can follow the same steps; [SETUP.md](SETUP.md) has more detail.

## Rules for the agent

- **Never ask the user to paste an API key into the chat**, and never write a key into a file that
  gets committed. Keys live in the user's shell profile (local) or in the cloud environment's
  settings (Claude Code on the web).
- Never print the value of `OAC_API_KEY`. The commands below only report whether a variable is set.
- Do not change settings the user did not ask for. Re-running `init` is safe: it only replaces its
  own block in `CLAUDE.md` and the `helpers` entry in `.mcp.json`.

## Steps

**1. Wire the project.** From the project root:

```bash
npx -y github:HTB95/open-agent-connector init
```

It writes `.mcp.json`, `.claude/settings.json`, the policy block in `CLAUDE.md` and a `.gitignore`
entry, then prints a line like `OAC_BASE_URL ✓ · OAC_API_KEY ✗ · …` (values hidden).

**2. If `OAC_BASE_URL` or `OAC_API_KEY` is missing**, stop and tell the user exactly where to set
them. Do not continue until they confirm. Offer the snippet that fits their setup:

- Local, macOS/Linux: add to `~/.zshrc` or `~/.bashrc`, then open a new terminal:
  ```bash
  export OAC_BASE_URL="https://your-gateway.example/v1"   # must end with /v1 for most gateways
  export OAC_API_KEY="..."                                # typed by the user, not by you
  ```
- Local, Windows: `setx OAC_BASE_URL "https://your-gateway.example/v1"` and `setx OAC_API_KEY "..."`,
  then open a new terminal.
- Claude Code on the web: the environment's settings → environment variables, one `KEY=value`
  per line. A new session is needed to pick them up.

**3. Pick the model ids.** Run:

```bash
npx -y github:HTB95/open-agent-connector doctor
```

It lists what the backend advertises and, when `OAC_TEXT_MODELS` / `OAC_IMAGE_MODELS` are empty,
prints suggested values such as `OAC_TEXT_MODELS=a,b,c`. Show the suggestion to the user, explain
that the order is the failover order, and let them set the variables the same way as in step 2.
Leave `OAC_IMAGE_JUDGE` unset (default `false`: image models are tried one after another and the
first success is used). Set it to `true` only if the user wants every image model to draw and a
helper to rank the results.

**4. Smoke-test** (each probe is one cheap helper call):

```bash
npx -y github:HTB95/open-agent-connector doctor --text --fetch
```

Add `--search` if the user configured a search route and `--image` if they set image models. If a
probe fails, read the `Hint:` line and the `⚠️ Configured but not advertised` warning, fix the
variable with the user, and run it again.

**5. Commit and restart.** Commit the files from step 1 (they contain no secrets), then tell the
user to start a **new** Claude Code session and run `/mcp`; `helpers` should show as connected.
For image generation, also suggest `MCP_TOOL_TIMEOUT=300000` in the environment that launches
Claude Code.

## Done when

- `doctor --text` passes.
- `.mcp.json` contains only `${OAC_…:-}` references.
- The user knows where their key is stored and that changes need a new session.
