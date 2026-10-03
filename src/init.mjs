import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const SERVER_NAME = 'helpers';
export const DEFAULT_SPEC = 'github:HTB95/open-agent-connector';
const MARK_START = '<!-- open-agent-connector:start -->';
const MARK_END = '<!-- open-agent-connector:end -->';
const POLICY_FILE = fileURLToPath(new URL('../examples/CLAUDE.md', import.meta.url));
const SERVER_FILE = fileURLToPath(new URL('../bin/server.mjs', import.meta.url));
// Settings forwarded from the user's shell / cloud environment into the MCP server process.
export const PASSTHROUGH_ENV = [
  'OAC_BASE_URL',
  'OAC_API_KEY',
  'OAC_TEXT_MODELS',
  'OAC_IMAGE_MODELS',
  'OAC_JUDGE_MODEL',
  'OAC_SEARCH_PROVIDERS',
  'OAC_SEARCH_MODEL',
  'OAC_FETCH_PROVIDERS',
];

/**
 * @SecondBrain
 * @Description Builds the `.mcp.json` entry for the helpers server. Secrets are never written:
 *   values use Claude Code's `${VAR}` / `${VAR:-default}` expansion, so the same committed file
 *   works locally (shell env) and in cloud sessions (environment variables in settings).
 * @History:
 *   [2026-10-03 08] [Created] - The user wants one setup for local and cloud Claude Code; a
 *     committed .mcp.json + env expansion is the only config both read.
 *   [2026-10-03 09] [Updated] - Forwards the generic OAC_* vars (all with `:-` empty defaults
 *     so a missing optional var never breaks config parsing) instead of NINEROUTER_*.
 */
export function buildServerEntry({ local = false, spec = DEFAULT_SPEC } = {}) {
  return {
    type: 'stdio',
    command: local ? 'node' : 'npx',
    args: local ? [SERVER_FILE] : ['-y', spec],
    env: {
      ...Object.fromEntries(PASSTHROUGH_ENV.map((k) => [k, `\${${k}:-}`])),
      // Relative => resolved inside the project, so cloud sessions can show/commit the images.
      OAC_IMAGE_OUT_DIR: '${OAC_IMAGE_OUT_DIR:-.generated-images}',
    },
  };
}

/**
 * @SecondBrain
 * @Description Adds/replaces only the `helpers` server in an existing .mcp.json, keeping the
 *   user's other servers untouched.
 * @History:
 *   [2026-10-03 08] [Created] - init must be safe to re-run in projects with other MCP servers.
 */
export function mergeMcpJson(existingText, entry) {
  const data = existingText ? JSON.parse(existingText) : {};
  data.mcpServers = { ...(data.mcpServers ?? {}), [SERVER_NAME]: entry };
  return `${JSON.stringify(data, null, 2)}\n`;
}

/**
 * @SecondBrain
 * @Description Pre-approves the project's `helpers` server in .claude/settings.json so cloud
 *   sessions (no one there to click "approve") load it automatically.
 * @History:
 *   [2026-10-03 08] [Created] - Project .mcp.json servers otherwise wait for interactive approval.
 */
export function mergeSettings(existingText) {
  const data = existingText ? JSON.parse(existingText) : {};
  const enabled = new Set(data.enabledMcpjsonServers ?? []);
  enabled.add(SERVER_NAME);
  data.enabledMcpjsonServers = [...enabled];
  return `${JSON.stringify(data, null, 2)}\n`;
}

/**
 * @SecondBrain
 * @Description Inserts (or refreshes) the delegation policy between marker comments in
 *   CLAUDE.md. Everything outside the markers is preserved byte for byte.
 * @History:
 *   [2026-10-03 08] [Created] - CLAUDE.md is what tells Claude in *every* new session, local or
 *     cloud, to use the helpers; markers make re-running init idempotent.
 */
export function upsertPolicy(existingText, policy) {
  const block = `${MARK_START}\n${policy.trim()}\n${MARK_END}`;
  const text = existingText ?? '';
  const start = text.indexOf(MARK_START);
  const end = text.indexOf(MARK_END);
  if (start !== -1 && end > start) return text.slice(0, start) + block + text.slice(end + MARK_END.length);
  return `${text}${text && !text.endsWith('\n') ? '\n' : ''}${text ? '\n' : ''}${block}\n`;
}

async function readOrNull(file) {
  try {
    return await readFile(file, 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') return null;
    throw err;
  }
}

/**
 * @SecondBrain
 * @Description `open-agent-connector init [--local] [--ref <git-ref>] [--dir <project>]`:
 *   wires the current project for Claude Code — .mcp.json, .claude/settings.json, CLAUDE.md
 *   policy and a .gitignore entry for generated images. Returns the list of touched files.
 * @History:
 *   [2026-10-03 08] [Created] - One command per project instead of hand-editing four files.
 *   [2026-10-03 09] [Updated] - Next-step hint lists the generic OAC_* vars.
 */
export async function runInit(argv = [], { cwd = process.cwd(), log = console.log } = {}) {
  const opt = (name) => {
    const i = argv.indexOf(name);
    return i !== -1 ? argv[i + 1] : undefined;
  };
  const dir = path.resolve(cwd, opt('--dir') ?? '.');
  const local = argv.includes('--local');
  const ref = opt('--ref');
  const spec = ref ? `${DEFAULT_SPEC}#${ref}` : DEFAULT_SPEC;
  const policy = await readFile(POLICY_FILE, 'utf8');
  const touched = [];

  const write = async (rel, content) => {
    const file = path.join(dir, rel);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, content);
    touched.push(rel);
  };

  await write('.mcp.json', mergeMcpJson(await readOrNull(path.join(dir, '.mcp.json')), buildServerEntry({ local, spec })));
  await write('.claude/settings.json', mergeSettings(await readOrNull(path.join(dir, '.claude/settings.json'))));
  await write('CLAUDE.md', upsertPolicy(await readOrNull(path.join(dir, 'CLAUDE.md')), policy));
  const gi = (await readOrNull(path.join(dir, '.gitignore'))) ?? '';
  if (!gi.split(/\r?\n/).includes('.generated-images/')) {
    await write('.gitignore', `${gi}${gi && !gi.endsWith('\n') ? '\n' : ''}.generated-images/\n`);
  }

  log(`open-agent-connector: wired ${dir}`);
  for (const f of touched) log(`  updated ${f}`);
  log(local ? `  server: node ${SERVER_FILE}` : `  server: npx -y ${spec}`);
  log('Next: set OAC_BASE_URL, OAC_API_KEY, OAC_TEXT_MODELS (and OAC_IMAGE_MODELS for images) in your environment, then start Claude Code.');
  return touched;
}
