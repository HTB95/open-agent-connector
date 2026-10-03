#!/usr/bin/env node
/**
 * @SecondBrain
 * @Description `open-agent-connector doctor [--text] [--search] [--fetch] [--image]`: smoke-tests
 *   the configured backend (reachability, model discovery, optional live text/search/fetch/image
 *   calls) before wiring the connector into Claude Code — debugging here costs zero Claude tokens.
 * @History:
 *   [2026-10-03 06] [Created] - Fail fast outside Claude instead of via failed tool calls.
 *   [2026-10-03 07] [Updated] - Added --fetch smoke test for the new web_fetch tool.
 *   [2026-10-03 09] [Updated] - Vendor-neutral probes (Node.js release query, example.com) and
 *     OAC_* wording, since 9router is only one possible backend; exits 1 if any probe fails.
 */
import { createContext } from '../src/context.mjs';
import { TOOLS } from '../src/tools/index.mjs';

const ctx = createContext();
const flags = new Set(process.argv.slice(2));
const tool = (name) => TOOLS.find((t) => t.definition.name === name);
let failed = false;

const probe = async (label, name, args) => {
  const r = await tool(name).handler(ctx, args);
  if (r.isError) failed = true;
  console.log(`\n[${label}]${r.isError ? ' FAILED' : ''}\n${r.text}`);
};

console.log(`API key: ${ctx.config.apiKey ? 'set' : 'not set'}`);
console.log((await tool('list_helper_models').handler(ctx)).text);

if (flags.has('--text')) await probe('ask_agent all', 'ask_agent', { prompt: 'Reply with exactly: pong', model: 'all' });
if (flags.has('--search')) await probe('web_search', 'web_search', { query: 'What is the current Node.js LTS version?' });
if (flags.has('--fetch')) {
  await probe('web_fetch', 'web_fetch', { url: 'https://example.com', question: 'What is this page for, in one sentence?' });
}
if (flags.has('--image')) {
  await probe('generate_images', 'generate_images', { prompt: 'A minimalist red circle on white', quality: 'low' });
}
if (!flags.size) console.log('\nTip: add --text --search --fetch --image to run live probes.');
process.exitCode = failed ? 1 : 0;
