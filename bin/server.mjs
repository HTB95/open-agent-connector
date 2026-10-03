#!/usr/bin/env node
/**
 * @SecondBrain
 * @Description CLI entry. No subcommand = run the stdio MCP server (what Claude Code spawns);
 *   `init` wires a project; `doctor` smoke-tests the configured backend.
 * @History:
 *   [2026-10-03 06] [Created] - MCP server entry point.
 *   [2026-10-03 08] [Updated] - Added `init`/`doctor` subcommands so `npx -y
 *     github:HTB95/open-agent-connector <cmd>` works without cloning the repo.
 *   [2026-10-03 09] [Updated] - Description made backend-neutral (9router is just one option).
 */
import { readFileSync } from 'node:fs';

const [cmd, ...rest] = process.argv.slice(2);

if (cmd === 'init') {
  const { runInit } = await import('../src/init.mjs');
  await runInit(rest);
} else if (cmd === 'doctor') {
  await import('./doctor.mjs');
} else {
  const { createContext } = await import('../src/context.mjs');
  const { McpServer } = await import('../src/mcp-server.mjs');
  const { TOOLS } = await import('../src/tools/index.mjs');
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  const server = new McpServer({ name: pkg.name, version: pkg.version, tools: TOOLS, ctx: createContext() });
  await server.start();
}
