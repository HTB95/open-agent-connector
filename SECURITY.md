# Security policy

## Reporting a vulnerability

Please **do not open a public issue** for security problems. Use GitHub's
[private vulnerability reporting](https://github.com/HTB95/open-agent-connector/security/advisories/new)
instead. Describe the issue and how to reproduce it, and say what impact you expect.

## Scope notes

- The connector sends `OAC_API_KEY` as a bearer token to `OAC_BASE_URL`. Use HTTPS for any
  endpoint that isn't on localhost.
- `web_fetch` fetches arbitrary `http(s)` URLs from the machine running the connector. Keep that in
  mind if that machine can reach internal services.
- Generated `.mcp.json` files must never contain secrets. Report any path that writes one.
