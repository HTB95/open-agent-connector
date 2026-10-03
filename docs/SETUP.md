# Setup guide

The connector is a stdio MCP server that runs with `npx -y github:HTB95/open-agent-connector`. You
don't need to clone it or run `npm install`. Wherever you use Claude, two things must be in place:

1. **The `helpers` MCP server** plus its `OAC_*` environment variables (see the
   [configuration table](../README.md#configuration)). This gives Claude the tools.
2. **The delegation policy in `CLAUDE.md`**. This tells Claude *when* to use the tools. Claude reads
   the file at the start of every session.

The `init` command writes both into a project:

```bash
cd your-project
npx -y github:HTB95/open-agent-connector init
```

| File | Contents | Commit? |
|---|---|---|
| `.mcp.json` | The `helpers` server. Variables are `${OAC_…:-}` references, never real keys. | ✅ |
| `.claude/settings.json` | `enabledMcpjsonServers: ["helpers"]`, which pre-approves the server. Cloud sessions have nobody to click "approve". | ✅ |
| `CLAUDE.md` | The delegation policy, between two marker comments. Re-running `init` replaces only that block. | ✅ |
| `.gitignore` | `.generated-images/` | ✅ |

Options:

- `--local`: run `node <clone>/bin/server.mjs` instead of npx.
- `--ref <git-ref>`: pin a branch, tag or commit.
- `--dir <path>`: target a different project directory.

---

## A. Local: Claude Code (CLI, Desktop app Code tab, VS Code, JetBrains)

**1. Set environment variables once.** This example uses a LiteLLM proxy. Use your own values.

```bash
# macOS / Linux: add to ~/.zshrc or ~/.bashrc
export OAC_BASE_URL="http://localhost:4000/v1"
export OAC_API_KEY="sk-..."
export OAC_TEXT_MODELS="gemini-flash,gpt-mini"
export OAC_IMAGE_MODELS="gpt-image,imagen"
export MCP_TOOL_TIMEOUT=300000          # image generation can take 30–120 s
```

```powershell
# Windows (PowerShell). Open a new terminal afterwards.
setx OAC_BASE_URL "http://localhost:4000/v1"
setx OAC_API_KEY "sk-..."
setx OAC_TEXT_MODELS "gemini-flash,gpt-mini"
setx OAC_IMAGE_MODELS "gpt-image,imagen"
setx MCP_TOOL_TIMEOUT "300000"
```

**2. Choose a scope.**

- **Per project (recommended, and the same setup works in the cloud):** run `init` as shown above, then commit.
- **Per user (every project on this machine):**
  ```bash
  claude mcp add helpers --scope user \
    -e OAC_BASE_URL="$OAC_BASE_URL" \
    -e OAC_API_KEY="$OAC_API_KEY" \
    -e OAC_TEXT_MODELS="$OAC_TEXT_MODELS" \
    -e OAC_IMAGE_MODELS="$OAC_IMAGE_MODELS" \
    -- npx -y github:HTB95/open-agent-connector
  ```
  Then copy [`examples/CLAUDE.md`](../examples/CLAUDE.md) into `~/.claude/CLAUDE.md`
  (on Windows: `%USERPROFILE%\.claude\CLAUDE.md`).

**3. Verify.** Start Claude Code and run `/mcp`. You should see `helpers · connected`. To check the
backend itself, run `npx -y github:HTB95/open-agent-connector doctor --text --search --image`.

## B. Cloud: Claude Code on the web and mobile

Cloud sessions run on Anthropic-managed machines. They **cannot reach your `localhost` or private
network** (LAN, Tailscale, …), so your backend needs a public **HTTPS** URL. A hosted provider
works as is. For a self-hosted gateway, use a tunnel such as Cloudflare Tunnel or ngrok, or the
gateway's own tunnel feature.

1. **Project:** run `init` in the repo, then commit and push. You only do this once per repo.
2. **Environment settings:** open the cloud environment menu → **Edit**.
   - *Environment variables*:
     ```
     OAC_BASE_URL=https://your-gateway.example.com/v1
     OAC_API_KEY=sk-...
     OAC_TEXT_MODELS=...
     OAC_IMAGE_MODELS=...
     MCP_TOOL_TIMEOUT=300000
     ```
   - *Network access*: choose **Custom** and add your gateway's domain to *Allowed domains*.
     **Keep** the default list, because `npx` needs GitHub and the npm registry to download the
     connector. Docs: <https://code.claude.com/docs/en/cloud-environments#network-access>
3. Start a **new** session on that repo and ask: *"call list_helper_models"*.

> Never paste API keys into a chat. Put them in environment variables.
> Generated images are saved in the repo's `.generated-images/` folder, so you can open them from the app.

> **Environment variables are read when a session starts.** After you add or change one, start a
> **new** cloud session. A running session keeps the old values, so the change looks like it did
> nothing.

### Gateway behind a reverse proxy or CDN

If you expose a self-hosted gateway through a reverse proxy or CDN of your choice:

- **Route the hostname straight to the gateway's port** with the proxy's own routing rule or a
  tunnel. Edge-function proxies often cannot reach a bare IP address or an unusual port.
- **Error 1010** (HTTP 403, body `error code: 1010`): a bot or browser check rejected the client.
  Skip that check for the API hostname or path. The connector sends
  `User-Agent: open-agent-connector`, which you can match in the rule.
- **HTTP 524**: the proxy stopped waiting for the gateway (often around 100 seconds). Image
  generation can take longer. Raise the proxy timeout, use a direct hostname or a tunnel for the
  gateway, or pick faster image models.

The connector appends a `Hint:` line to these errors.

## C. Claude Desktop (Chat tab) and claude.ai

- **Claude Desktop, Chat tab:** add the server in Settings → Developer → Edit Config
  (`claude_desktop_config.json`):
  ```json
  {
    "mcpServers": {
      "helpers": {
        "command": "npx",
        "args": ["-y", "github:HTB95/open-agent-connector"],
        "env": {
          "OAC_BASE_URL": "http://localhost:4000/v1",
          "OAC_API_KEY": "sk-...",
          "OAC_TEXT_MODELS": "gemini-flash",
          "OAC_IMAGE_MODELS": "gpt-image"
        }
      }
    }
  }
  ```
  This file does not support `${VAR}` expansion, so the key has to be written into it. Keep the
  file private.
- **claude.ai web chat (custom connectors):** custom connectors require a remote HTTP MCP server.
  This connector is stdio only, so it is **not supported yet**.

---

## D. Getting Claude to use the helpers in another session

If the project ran `init`, or you edited `~/.claude/CLAUDE.md`, **you don't need to do anything**.
Claude reads `CLAUDE.md` at the start of every session, and the server also sends usage
instructions when it connects. Example requests:

- *"Look up the breaking changes in the latest Next.js major using the helpers and summarise them."* → `web_search`
- *"Read https://… with web_fetch and tell me the API rate limit."* → `web_fetch`
- *"Generate 20 rows of test data with ask_agent (model all) and keep the better set."* → `ask_agent`
- *"Make an app logo with every image model, two each, review judge, and copy the best to `public/logo.png`."* → `generate_images`

In a repo that is **not** set up yet, paste this at the start of the session:

> Run `npx -y github:HTB95/open-agent-connector init`, commit, then read the policy section in
> `CLAUDE.md`. From now on, delegate search, page reading, drafting and image generation to the
> `helpers` MCP server to save tokens.

MCP servers load only **when a session starts**. After the first `init`, start a new session (cloud)
or restart Claude Code (local).

## Troubleshooting

| Symptom | Cause / fix |
|---|---|
| `/mcp` doesn't list `helpers` | You haven't started a new session since `init`, or (in the cloud) `.mcp.json` isn't committed. |
| Changed an environment variable but nothing changed | Variables load when a session starts. Start a new session (cloud) or restart Claude Code (local). |
| `⚠️ Configured but not advertised by GET /models` | A model id in `OAC_*_MODELS` is misspelled or has the wrong prefix (for example `ag/…` when the gateway exposes `xkr/google/…`). Copy the exact id from the advertised list. Calls to that id will fail. |
| `HTTP 403 … error code: 1010` | A proxy's bot check rejected the client. See [Gateway behind a reverse proxy or CDN](#gateway-behind-a-reverse-proxy-or-cdn). |
| `HTTP 524` | The proxy timed out waiting for the gateway, usually on image generation. Same section as above. |
| `HTTP 502` from one model | That model's upstream provider failed. `ask_agent` with `model: "auto"` moves to the next text model by itself. For images, check the provider in your gateway dashboard. |
| `OAC_BASE_URL is not set` | The variable isn't in the environment Claude Code was launched from. Restart the terminal or app after `setx` or editing your profile. |
| `Cannot reach the gateway at …` | Wrong URL, or (in the cloud) no public HTTPS URL or the domain is missing from *Allowed domains*. |
| `HTTP 401` | `OAC_API_KEY` is missing or invalid. |
| `No text model available` | Set `OAC_TEXT_MODELS`, or make sure `GET /models` works. |
| `No image models configured` | Set `OAC_IMAGE_MODELS`. |
| `NOT A LIVE SEARCH` | No search route works. Set `OAC_SEARCH_PROVIDERS` (native endpoint) or `OAC_SEARCH_MODEL` (Responses `web_search`). |
| Image generation times out | Raise `MCP_TOOL_TIMEOUT` (ms) and/or `OAC_IMAGE_TIMEOUT_MS`. |
| Only some image models return images | Run `doctor --image`. The failing models are listed under `Failures:` with the backend's error. |
