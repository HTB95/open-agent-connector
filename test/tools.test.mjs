import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createContext } from '../src/context.mjs';
import { pickDefaultTextModel, suggestModels, unadvertised } from '../src/models.mjs';
import { isOpenAiStyleImageModel } from '../src/tools/images.mjs';
import { gatewayHint, parseSse } from '../src/router-client.mjs';
import { clip } from '../src/tools/text.mjs';
import { TOOLS } from '../src/tools/index.mjs';
import { startMockRouter } from './mock-router.mjs';

const tool = (name) => TOOLS.find((t) => t.definition.name === name);

// A 9router-style setup (the mock speaks 9router's native search/fetch endpoints too).
const BASE_ENV = {
  OAC_API_KEY: 'k',
  OAC_TEXT_MODELS: 'ag/gemini-3.5-flash-medium,cx/gpt-5.5',
  OAC_IMAGE_MODELS: 'cx/gpt-image-2.5,ag/gemini-3.1-flash-image',
  OAC_SEARCH_PROVIDERS: 'antigravity,searxng',
  OAC_SEARCH_MODEL: 'cx/gpt-5.5',
};

async function setup(opts, extraEnv = {}) {
  const router = await startMockRouter(opts);
  const outDir = await mkdtemp(path.join(os.tmpdir(), 'oac-test-'));
  const ctx = createContext({ env: { ...BASE_ENV, OAC_BASE_URL: router.baseUrl, OAC_IMAGE_OUT_DIR: outDir, ...extraEnv } });
  return { router, ctx, outDir };
}

test('pickDefaultTextModel skips image/embedding ids; image param detection is name based', () => {
  assert.equal(pickDefaultTextModel(['dall-e-3', 'text-embedding-3-small', 'ag/gemini-3.1-flash-image', 'gpt-5-mini']), 'gpt-5-mini');
  assert.equal(pickDefaultTextModel(['tts-1']), null);
  assert.ok(isOpenAiStyleImageModel('cx/gpt-image-2.5'));
  assert.ok(isOpenAiStyleImageModel('cx/gpt-5.6-luna-image'));
  assert.ok(isOpenAiStyleImageModel('dall-e-3'));
  assert.ok(!isOpenAiStyleImageModel('ag/gemini-3.1-flash-image'));
});

test('parseSse skips [DONE] and junk', () => {
  assert.deepEqual(parseSse('event: x\ndata: {"a":1}\n\ndata: oops\ndata: [DONE]\n'), [{ a: 1 }]);
});

test('clip truncates and annotates', () => {
  assert.equal(clip('abc', 5), 'abc');
  assert.match(clip('abcdefgh', 3), /^abc\n\n…\[truncated 5 chars/);
});

test('ask_agent auto uses the first model in OAC_TEXT_MODELS and sends bearer key', async () => {
  const { router, ctx } = await setup();
  try {
    const r = await tool('ask_agent').handler(ctx, { prompt: 'hi' });
    assert.ok(!r.isError);
    assert.match(r.text, /answer from ag\/gemini-3\.5-flash-medium/);
    assert.equal(router.calls.find((c) => c.url === '/v1/chat/completions').auth, 'Bearer k');
  } finally {
    await router.close();
  }
});

test('ask_agent auto fails over to the next text model', async () => {
  const { router, ctx } = await setup({ fail: new Set(['chat-ag']) });
  try {
    const r = await tool('ask_agent').handler(ctx, { prompt: 'hi' });
    assert.ok(!r.isError);
    assert.match(r.text, /answer from cx\/gpt-5\.5/);
  } finally {
    await router.close();
  }
});

test('ask_agent all returns every answer; reports partial failure', async () => {
  const { router, ctx } = await setup({ fail: new Set(['chat-cx']) });
  try {
    const r = await tool('ask_agent').handler(ctx, { prompt: 'hi', model: 'all' });
    assert.ok(!r.isError);
    assert.match(r.text, /cx\/gpt-5\.5 FAILED/);
    assert.match(r.text, /answer from ag\//);
  } finally {
    await router.close();
  }
});

test('web_search prefers the native search endpoint with the first provider', async () => {
  const { router, ctx } = await setup();
  try {
    const r = await tool('web_search').handler(ctx, { query: '9router latest' });
    assert.match(r.text, /live search · antigravity/);
    assert.match(r.text, /Latest is v0\.5\.95\./);
    assert.match(r.text, /1\. Releases — https:\/\/github\.com\/decolua\/9router\/releases\n {3}v0\.5\.95 released/);
    const call = router.calls.find((c) => c.url === '/v1/search');
    assert.deepEqual(call.body, { model: 'antigravity', query: '9router latest', max_results: 5 });
    assert.ok(!router.calls.some((c) => c.url === '/v1/responses'));
  } finally {
    await router.close();
  }
});

test('web_search falls back provider -> provider -> Responses web_search -> labelled offline answer', async () => {
  let { router, ctx } = await setup({ fail: new Set(['search-antigravity']) });
  try {
    assert.match((await tool('web_search').handler(ctx, { query: 'x' })).text, /live search · searxng/);
  } finally {
    await router.close();
  }
  ({ router, ctx } = await setup({ fail: new Set(['search-antigravity', 'search-searxng']) }));
  try {
    const r = await tool('web_search').handler(ctx, { query: 'x' });
    assert.match(r.text, /live search · responses web_search \(cx\/gpt-5\.5\)/);
    assert.match(r.text, /Releases: https:\/\/github\.com/);
  } finally {
    await router.close();
  }
  ({ router, ctx } = await setup({ fail: new Set(['search-antigravity', 'search-searxng', 'responses']) }));
  try {
    const r = await tool('web_search').handler(ctx, { query: 'x' });
    assert.match(r.text, /NOT A LIVE SEARCH/);
  } finally {
    await router.close();
  }
});

test('web_search on a chat-only backend skips search routes and says so', async () => {
  const { router, ctx } = await setup({}, { OAC_SEARCH_PROVIDERS: '', OAC_SEARCH_MODEL: '' });
  try {
    const r = await tool('web_search').handler(ctx, { query: 'x' });
    assert.match(r.text, /NOT A LIVE SEARCH — no live search route configured/);
    assert.ok(!router.calls.some((c) => c.url === '/v1/search' || c.url === '/v1/responses'));
  } finally {
    await router.close();
  }
});

test('web_fetch: local fetch strips chrome; question is digested by the first text model', async () => {
  const { router, ctx } = await setup();
  try {
    const url = router.baseUrl.replace('/v1', '/page.html');
    const raw = await tool('web_fetch').handler(ctx, { url });
    assert.match(raw.text, /\[local fetch · Docs/);
    assert.match(raw.text, /API\nPort is 12121 & key required\./);
    assert.doesNotMatch(raw.text, /evil|menu|x\{\}/);
    const asked = await tool('web_fetch').handler(ctx, { url, question: 'which port?' });
    assert.match(asked.text, /digested by ag\/gemini-3\.5-flash-medium/);
    const helperCall = router.calls.filter((c) => c.url === '/v1/chat/completions').at(-1);
    assert.match(helperCall.body.messages[1].content, /Port is 12121/);
  } finally {
    await router.close();
  }
});

test('web_fetch uses OAC_FETCH_PROVIDERS when configured, rejects bad urls', async () => {
  const router = await startMockRouter();
  const ctx = createContext({ env: { OAC_BASE_URL: router.baseUrl, OAC_FETCH_PROVIDERS: 'jina-reader' } });
  try {
    const r = await tool('web_fetch').handler(ctx, { url: 'https://example.com' });
    assert.match(r.text, /fetch provider jina-reader · Fetched/);
    assert.equal(router.calls.find((c) => c.url === '/v1/web/fetch').body.model, 'jina-reader');
    assert.ok((await tool('web_fetch').handler(ctx, { url: 'file:///etc/passwd' })).isError);
  } finally {
    await router.close();
  }
});

test('generate_images judge=true fans out to every image model via images API and saves files', async () => {
  const { router, ctx, outDir } = await setup({ fail: new Set(['judge']) });
  try {
    const r = await tool('generate_images').handler(ctx, { prompt: 'cat', judge: true, n_per_model: 2, quality: 'high', background: 'transparent' });
    assert.ok(!r.isError, r.text);
    assert.match(r.text, /Candidates \(4\/4\)/);
    const files = [...r.text.matchAll(/(\/\S+\.png)/g)].map((m) => m[1]);
    assert.equal(files.length, 4);
    for (const f of files) {
      assert.ok(f.startsWith(outDir));
      assert.equal((await readFile(f))[1], 0x50); // PNG magic "P"
    }
    const calls = router.calls.filter((c) => c.url === '/v1/images/generations');
    const cx = calls.find((c) => c.body.model === 'cx/gpt-image-2.5');
    const ag = calls.find((c) => c.body.model === 'ag/gemini-3.1-flash-image');
    assert.equal(cx.body.quality, 'high');
    assert.equal(cx.body.background, 'transparent');
    assert.equal(cx.body.response_format, undefined); // unsupported by gpt-image-*
    assert.equal(ag.body.quality, undefined); // OpenAI-only params are not sent to Gemini
    assert.equal(ag.body.response_format, 'b64_json');
    assert.ok(!router.calls.some((c) => c.url === '/v1/responses'));
  } finally {
    await router.close();
  }
});

test('generate_images: three models, judge ranks, inline embeds a subset', async () => {
  const { router, ctx } = await setup({}, {
    OAC_IMAGE_MODELS: 'cx/gpt-image-2.5,cx/gpt-5.6-luna-image,ag/gemini-3.1-flash-image',
  });
  try {
    const judged = await tool('generate_images').handler(ctx, { prompt: 'cat', judge: true });
    assert.match(judged.text, /Candidates \(3\/3\)/);
    assert.match(judged.text, /gpt-5\.6-luna-image/);
    assert.match(judged.text, /c2 score 9: cleaner/);
    const inline = await tool('generate_images').handler(ctx, { prompt: 'cat', review: 'inline', models: ['ag/gemini-3.1-flash-image'] });
    assert.equal(inline.content.filter((c) => c.type === 'image').length, 1);
  } finally {
    await router.close();
  }
});

test('generate_images defaults to ordered fallback: stops at the first model that succeeds', async () => {
  const { router, ctx } = await setup({ fail: new Set(['images-cx']) });
  try {
    const r = await tool('generate_images').handler(ctx, { prompt: 'cat' });
    assert.ok(!r.isError, r.text);
    assert.match(r.text, /Mode: fallback/);
    assert.match(r.text, /Candidates \(1\/1\)/);
    assert.match(r.text, /c1 · ag\/gemini-3\.1-flash-image/);
    assert.match(r.text, /cx\/gpt-image-2\.5#1: .*images cx down/);
    assert.doesNotMatch(r.text, /Judge \(/);
    const first = await tool('generate_images').handler(ctx, { prompt: 'cat', models: ['ag/gemini-3.1-flash-image', 'cx/gpt-image-2.5'] });
    assert.match(first.text, /Candidates \(1\/1\)/);
    const calls = router.calls.filter((c) => c.url === '/v1/images/generations').map((c) => c.body.model);
    assert.deepEqual(calls, ['cx/gpt-image-2.5', 'ag/gemini-3.1-flash-image', 'ag/gemini-3.1-flash-image']);
  } finally {
    await router.close();
  }
});

test('OAC_IMAGE_JUDGE=true turns fan-out + judge on by default; judge=false overrides it', async () => {
  const { router, ctx } = await setup({}, { OAC_IMAGE_JUDGE: 'true' });
  try {
    assert.equal(ctx.config.imageJudge, true);
    const judged = await tool('generate_images').handler(ctx, { prompt: 'cat' });
    assert.match(judged.text, /Mode: judge \(2 models in parallel\)/);
    assert.match(judged.text, /c2 score 9: cleaner/);
    const single = await tool('generate_images').handler(ctx, { prompt: 'cat', judge: false });
    assert.match(single.text, /Candidates \(1\/1\)/);
  } finally {
    await router.close();
  }
  assert.equal(createContext({ env: {} }).config.imageJudge, false);
});

test('suggestModels proposes text and image ids from GET /models', () => {
  const ids = ['cx/gpt-5.4', 'text-embedding-3-small', 'ag/gemini-3.1-flash-image', 'kr/glm-5', 'dall-e-3', 'x/flux-1', 'y/a', 'z/b'];
  assert.deepEqual(suggestModels(ids), {
    text: ['cx/gpt-5.4', 'kr/glm-5', 'y/a'],
    images: ['ag/gemini-3.1-flash-image', 'dall-e-3', 'x/flux-1'],
  });
  assert.deepEqual(suggestModels([]), { text: [], images: [] });
});

test('generate_images reports isError only when every model fails', async () => {
  const { router, ctx } = await setup({ fail: new Set(['images-cx', 'images-ag']) });
  try {
    const r = await tool('generate_images').handler(ctx, { prompt: 'cat' });
    assert.ok(r.isError);
    assert.match(r.text, /cx\/gpt-image-2\.5#1: .*images cx down/);
    assert.match(r.text, /ag\/gemini-3\.1-flash-image#1: .*images ag down/);
  } finally {
    await router.close();
  }
});

test('clear errors: unreachable backend, missing base URL, no image models', async () => {
  const ctx = createContext({ env: { OAC_BASE_URL: 'http://127.0.0.1:9/v1' } });
  const r = await tool('ask_agent').handler(ctx, { prompt: 'hi', model: 'some/model' });
  assert.ok(r.isError);
  assert.match(r.text, /Cannot reach the gateway at http:\/\/127\.0\.0\.1:9\/v1/);

  const unset = createContext({ env: {} });
  assert.equal(unset.config.baseUrl, '');
  const r2 = await tool('ask_agent').handler(unset, { prompt: 'hi', model: 'some/model' });
  assert.match(r2.text, /OAC_BASE_URL is not set/);
  const r3 = await tool('generate_images').handler(unset, { prompt: 'cat' });
  assert.ok(r3.isError);
  assert.match(r3.text, /Set OAC_IMAGE_MODELS/);
});

test('text model is auto-picked from GET /models when OAC_TEXT_MODELS is empty', async () => {
  const { router, ctx } = await setup({}, { OAC_TEXT_MODELS: '' });
  try {
    const r = await tool('ask_agent').handler(ctx, { prompt: 'hi' });
    assert.match(r.text, /answer from cx\/gpt-5\.4/); // first non-image id the mock advertises
    const list = await tool('list_helper_models').handler(ctx);
    assert.match(list.text, /text \(OAC_TEXT_MODELS, auto-picked\): cx\/gpt-5\.4/);
    assert.match(list.text, /Advertised models \(8\)/);
  } finally {
    await router.close();
  }
});

test('gatewayHint maps proxy and upstream failures; unadvertised flags unknown ids', () => {
  assert.match(gatewayHint(403, 'error code: 1010'), /error 1010/);
  assert.equal(gatewayHint(403, 'forbidden'), '');
  assert.match(gatewayHint(524, ''), /timed out/);
  assert.match(gatewayHint(502, ''), /another model id/);
  assert.match(gatewayHint(401, ''), /OAC_API_KEY/);
  assert.equal(gatewayHint(500, ''), '');
  assert.deepEqual(unadvertised(['a', 'b', null, 'b'], ['a']), ['b']);
  assert.deepEqual(unadvertised(['a'], []), []); // no /models data -> no verdict
});

test('list_helper_models warns about configured ids the backend does not advertise', async () => {
  const { router, ctx } = await setup({}, { OAC_TEXT_MODELS: 'cx/gpt-5.5,ag/gemini-2.5-flash' });
  try {
    const list = await tool('list_helper_models').handler(ctx);
    const warning = list.text.split('\n').find((l) => l.startsWith('⚠️'));
    assert.match(warning, /ag\/gemini-2\.5-flash/);
    assert.match(warning, /cx\/gpt-image-2\.5/); // image model missing from the mock's /models
    assert.doesNotMatch(warning, /cx\/gpt-5\.5\b/); // advertised, so not flagged
  } finally {
    await router.close();
  }
});
