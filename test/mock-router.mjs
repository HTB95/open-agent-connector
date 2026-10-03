import http from 'node:http';

// 1x1 transparent PNG.
export const PNG_B64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

/**
 * Fake OpenAI-compatible gateway (9router-flavoured, incl. native /search and /web/fetch) used by the tests. `opts.fail` is a Set of feature names to force 500s:
 * 'responses', 'images-ag', 'images-cx', 'chat-ag', 'chat-cx', 'judge', 'search-antigravity',
 * 'search-searxng', 'fetch'. GET /page.html serves a static page for local web_fetch.
 */
export function startMockRouter(opts = {}) {
  const fail = opts.fail ?? new Set();
  const calls = [];
  const server = http.createServer(async (req, res) => {
    let raw = '';
    for await (const chunk of req) raw += chunk;
    const body = raw ? JSON.parse(raw) : {};
    calls.push({ method: req.method, url: req.url, body, auth: req.headers.authorization });
    const json = (code, obj) => {
      res.writeHead(code, { 'content-type': 'application/json' });
      res.end(JSON.stringify(obj));
    };
    const sse = (events) => {
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      for (const e of events) res.write(`data: ${JSON.stringify(e)}\n\n`);
      res.end('data: [DONE]\n\n');
    };

    if (req.url === '/page.html') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      return res.end('<html><head><title>Docs</title><style>x{}</style></head><body><nav>menu</nav><h1>API</h1><p>Port is 12121 &amp; key required.</p><script>evil()</script></body></html>');
    }
    if (req.url === '/v1/search') {
      if (fail.has(`search-${body.model}`)) return json(502, { error: { message: `${body.model} down` } });
      return json(200, {
        provider: body.model,
        query: body.query,
        results: [{ title: 'Releases', url: 'https://github.com/decolua/9router/releases', snippet: 'v0.5.95 released' }],
        answer: body.model === 'antigravity' ? { source: 'antigravity', text: 'Latest is v0.5.95.' } : null,
      });
    }
    if (req.url === '/v1/web/fetch') {
      if (fail.has('fetch')) return json(502, { error: { message: 'fetch down' } });
      return json(200, { provider: body.model, url: body.url, title: 'Fetched', content: { format: 'markdown', text: '# Fetched page' } });
    }
    if (req.url === '/v1/models') {
      return json(200, {
        data: ['cx/gpt-5.4', 'cx/gpt-5.5', 'cx/gpt-5.3-codex', 'ag/gemini-3.1-pro-high', 'ag/gemini-3.5-flash-medium',
          'ag/gemini-3.5-flash-low', 'ag/gemini-3.1-flash-image', 'kr/glm-5'].map((id) => ({ id })),
      });
    }
    if (req.url === '/v1/chat/completions') {
      const isJudge = Array.isArray(body.messages?.[0]?.content);
      if (isJudge) {
        if (fail.has('judge')) return json(500, { error: 'judge down' });
        return json(200, {
          choices: [{ message: { content: 'Sure!\n{"ranking":[{"id":"c2","score":9,"reason":"cleaner"},{"id":"c1","score":6,"reason":"artifacts"}]}' } }],
        });
      }
      const agent = body.model.startsWith('cx/') ? 'cx' : 'ag';
      if (fail.has(`chat-${agent}`)) return json(500, { error: `${agent} quota exhausted` });
      return json(200, {
        choices: [{ message: { content: `answer from ${body.model}` } }],
        usage: { prompt_tokens: 10, completion_tokens: 3 },
      });
    }
    if (req.url === '/v1/responses') {
      if (fail.has('responses')) return json(500, { error: 'responses unsupported' });
      const toolType = body.tools?.[0]?.type;
      if (toolType === 'web_search') {
        return sse([
          { type: 'response.output_item.done', item: { id: 'ws1', type: 'web_search_call', status: 'completed' } },
          {
            type: 'response.completed',
            response: {
              output: [
                { id: 'ws1', type: 'web_search_call' },
                { id: 'm1', type: 'message', content: [{ type: 'output_text', text: '9router v0.6 is latest.',
                  annotations: [{ type: 'url_citation', url: 'https://github.com/decolua/9router/releases', title: 'Releases' }] }] },
              ],
            },
          },
        ]);
      }
      if (toolType === 'image_generation') {
        return sse([{ type: 'response.output_item.done', item: { id: 'ig1', type: 'image_generation_call', result: PNG_B64 } }]);
      }
      return json(400, { error: 'unknown tool' });
    }
    if (req.url === '/v1/images/generations') {
      if ((req.headers.accept || '').includes('text/event-stream')) return sse([{ progress: 50 }]);
      const agent = body.model.startsWith('cx/') ? 'cx' : 'ag';
      if (fail.has(`images-${agent}`)) return json(500, { error: `images ${agent} down` });
      return json(200, { data: [{ b64_json: PNG_B64 }] });
    }
    json(404, { error: 'not found' });
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({ baseUrl: `http://127.0.0.1:${port}/v1`, calls, close: () => new Promise((r) => server.close(r)) });
    });
  });
}
