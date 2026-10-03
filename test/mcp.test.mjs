import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';
import { startMockRouter } from './mock-router.mjs';

const SERVER = fileURLToPath(new URL('../bin/server.mjs', import.meta.url));

test('stdio MCP handshake, tools/list and tools/call end-to-end', async () => {
  const router = await startMockRouter();
  const child = spawn(process.execPath, [SERVER], {
    env: { ...process.env, OAC_BASE_URL: router.baseUrl, OAC_TEXT_MODELS: 'cx/gpt-5.5' },
    stdio: ['pipe', 'pipe', 'inherit'],
  });
  const rl = readline.createInterface({ input: child.stdout });
  const pending = new Map();
  rl.on('line', (line) => {
    const msg = JSON.parse(line);
    pending.get(msg.id)?.(msg);
  });
  let nextId = 1;
  const rpc = (method, params) =>
    new Promise((resolve) => {
      const id = nextId++;
      pending.set(id, resolve);
      child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
    });

  try {
    const init = await rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '0' } });
    assert.equal(init.result.protocolVersion, '2025-06-18');
    assert.ok(init.result.capabilities.tools);
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`);

    const list = await rpc('tools/list', {});
    assert.deepEqual(list.result.tools.map((t) => t.name).sort(), ['ask_agent', 'generate_images', 'list_helper_models', 'web_fetch', 'web_search']);

    const call = await rpc('tools/call', { name: 'ask_agent', arguments: { prompt: 'hi' } });
    assert.equal(call.result.isError, false);
    assert.match(call.result.content[0].text, /answer from cx\/gpt-5\.5/);

    const missing = await rpc('tools/call', { name: 'ask_agent', arguments: {} });
    assert.equal(missing.result.isError, true);

    const unknown = await rpc('nope/method', {});
    assert.equal(unknown.error.code, -32601);

    const oldClient = await rpc('initialize', { protocolVersion: '1999-01-01' });
    assert.equal(oldClient.result.protocolVersion, '2025-06-18');
  } finally {
    child.kill();
    await router.close();
  }
});
