import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, mkdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { buildServerEntry, envStatus, mergeMcpJson, mergeSettings, runInit, upsertPolicy } from '../src/init.mjs';

test('server entry never contains secrets and uses env expansion', () => {
  const e = buildServerEntry();
  assert.equal(e.command, 'npx');
  assert.deepEqual(e.args, ['-y', 'github:HTB95/open-agent-connector']);
  assert.equal(e.env.OAC_API_KEY, '${OAC_API_KEY:-}');
  assert.equal(e.env.OAC_BASE_URL, '${OAC_BASE_URL:-}');
  assert.equal(e.env.OAC_IMAGE_OUT_DIR, '${OAC_IMAGE_OUT_DIR:-.generated-images}');
  assert.ok(Object.values(e.env).every((v) => /^\$\{OAC_[A-Z_]+:-[^}]*\}$/.test(v)));
  const local = buildServerEntry({ local: true });
  assert.equal(local.command, 'node');
  assert.match(local.args[0], /bin[\\/]server\.mjs$/);
});

test('merge helpers keep other servers/settings and are idempotent', () => {
  const merged = JSON.parse(mergeMcpJson('{"mcpServers":{"other":{"command":"x"}}}', { command: 'npx' }));
  assert.deepEqual(Object.keys(merged.mcpServers).sort(), ['helpers', 'other']);
  const s1 = mergeSettings('{"model":"x","enabledMcpjsonServers":["a"]}');
  const s2 = mergeSettings(s1);
  assert.deepEqual(JSON.parse(s2), { model: 'x', enabledMcpjsonServers: ['a', 'helpers'] });
});

test('upsertPolicy appends once, then replaces only the marked block', () => {
  const first = upsertPolicy('# Project\nkeep me', 'v1');
  assert.match(first, /^# Project\nkeep me\n\n<!-- open-agent-connector:start -->\nv1\n<!-- open-agent-connector:end -->\n$/);
  const second = upsertPolicy(`${first}tail\n`, 'v2');
  assert.equal(second.match(/open-agent-connector:start/g).length, 1);
  assert.match(second, /keep me[\s\S]*v2[\s\S]*tail/);
  assert.doesNotMatch(second, /v1/);
});

test('runInit wires a project end-to-end and can be re-run', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'oac-init-'));
  await mkdir(path.join(dir, '.claude'));
  await writeFile(path.join(dir, '.gitignore'), 'node_modules/');
  const touched = await runInit(['--ref', 'my-branch'], { cwd: dir, log: () => {} });
  assert.deepEqual(touched, ['.mcp.json', '.claude/settings.json', 'CLAUDE.md', '.gitignore']);
  const mcp = JSON.parse(await readFile(path.join(dir, '.mcp.json'), 'utf8'));
  assert.deepEqual(mcp.mcpServers.helpers.args, ['-y', 'github:HTB95/open-agent-connector#my-branch']);
  assert.match(await readFile(path.join(dir, 'CLAUDE.md'), 'utf8'), /mcp__helpers__web_search/);
  assert.equal(await readFile(path.join(dir, '.gitignore'), 'utf8'), 'node_modules/\n.generated-images/\n');
  const again = await runInit([], { cwd: dir, log: () => {} });
  assert.ok(!again.includes('.gitignore'));
});

test('envStatus reports set/missing vars without leaking values; init prints next steps', async () => {
  const line = envStatus({ OAC_BASE_URL: 'http://x', OAC_API_KEY: 'sk-secret', OAC_TEXT_MODELS: ' ' });
  assert.match(line, /OAC_BASE_URL ✓ · OAC_API_KEY ✓ · OAC_TEXT_MODELS ✗/);
  assert.doesNotMatch(line, /sk-secret|http:\/\/x/);
  const dir = await mkdtemp(path.join(os.tmpdir(), 'oac-init-'));
  const out = [];
  await runInit([], { cwd: dir, log: (l) => out.push(l), env: { OAC_API_KEY: 'sk-secret' } });
  const text = out.join('\n');
  assert.doesNotMatch(text, /sk-secret/);
  assert.match(text, /Next: set OAC_BASE_URL/);
  assert.match(text, /npx -y github:HTB95\/open-agent-connector doctor/);
});
