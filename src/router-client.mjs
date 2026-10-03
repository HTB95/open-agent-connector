/**
 * @SecondBrain
 * @Description Error raised for any non-2xx / unparsable gateway response. Carries the HTTP
 *   status so callers can decide whether to fail over to the next model.
 * @History:
 *   [2026-10-03 06] [Created] - Failover logic needs a typed error, not string matching.
 */
export class RouterError extends Error {
  constructor(message, { status = 0, body = '' } = {}) {
    super(message);
    this.name = 'RouterError';
    this.status = status;
    this.body = body;
  }
}

/**
 * @SecondBrain
 * @Description Parses a Server-Sent-Events payload into an array of JSON objects. Some gateways
 *   answer in SSE even for stream:false (seen with 9router's Codex /v1/responses), so every
 *   call goes through this tolerant decoder.
 * @History:
 *   [2026-10-03 06] [Created] - Codex upstream is stream-only; do not trust stream:false.
 */
export function parseSse(text) {
  const events = [];
  for (const line of text.split(/\r?\n/)) {
    if (!line.startsWith('data:')) continue;
    const data = line.slice(5).trim();
    if (!data || data === '[DONE]') continue;
    try {
      events.push(JSON.parse(data));
    } catch {
      // Ignore keep-alive / non-JSON lines.
    }
  }
  return events;
}

/**
 * @SecondBrain
 * @Description Maps well-known gateway / reverse-proxy failures to a one-line fix, appended to
 *   the error so Claude (and the user) can act without guessing. Returns '' when nothing fits.
 * @History:
 *   [2026-10-03 11] [Created] - User feedback: proxy errors (1010, 524) and upstream 502s cost
 *     several debugging rounds when the gateway sat behind a reverse proxy / CDN.
 */
export function gatewayHint(status, body = '') {
  if (status === 403 && /\b1010\b/.test(body)) {
    return 'A reverse proxy / CDN in front of the gateway rejected this client (error 1010, bot or browser check). Allow User-Agent "open-agent-connector" or skip that check for the API path.';
  }
  if (status === 524) {
    return 'A reverse proxy in front of the gateway timed out waiting for it (HTTP 524). Raise the proxy timeout, or use a direct hostname or a tunnel for long calls such as image generation.';
  }
  if (status === 401) return 'Check OAC_API_KEY.';
  if (status === 502 || status === 503 || status === 504) {
    return 'The upstream provider behind the gateway failed. Try another model id and check the gateway dashboard.';
  }
  return '';
}

/**
 * @SecondBrain
 * @Description Minimal fetch wrapper around any OpenAI-compatible API: /chat/completions,
 *   /responses, /images/generations, /models plus optional native search/fetch endpoints
 *   (paths configurable, e.g. 9router's /search and /web/fetch).
 *   Returns `{ json }` for JSON bodies or `{ events }` for SSE bodies.
 * @History:
 *   [2026-10-03 06] [Created] - Zero-dependency client (Node >=18 global fetch) so users
 *     never need `npm install`.
 *   [2026-10-03 07] [Updated] - Added search()/webFetch() and per-call Accept header: user's
 *     dashboard showed images default to SSE when Accept has text/event-stream.
 *   [2026-10-03 09] [Updated] - Backend-agnostic: clear error when OAC_BASE_URL is unset,
 *     configurable search/fetch paths, vendor-neutral error messages.
 *   [2026-10-03 11] [Updated] - Errors carry a gatewayHint(); sends a User-Agent header, since
 *     some reverse proxies / CDNs run bot checks that reject requests without a clear client id.
 */
export class RouterClient {
  constructor(config, fetchImpl = globalThis.fetch) {
    this.config = config;
    this.fetch = fetchImpl;
  }

  headers(accept = 'application/json, text/event-stream') {
    const h = { 'Content-Type': 'application/json', Accept: accept, 'User-Agent': 'open-agent-connector' };
    if (this.config.apiKey) h.Authorization = `Bearer ${this.config.apiKey}`;
    return h;
  }

  async request(method, path, { body, timeoutMs = this.config.textTimeoutMs, accept } = {}) {
    if (!this.config.baseUrl) {
      throw new RouterError(
        'OAC_BASE_URL is not set. Point it at any OpenAI-compatible endpoint, e.g. http://localhost:4000/v1 or https://api.openai.com/v1.',
      );
    }
    const url = `${this.config.baseUrl}${path}`;
    let res;
    try {
      res = await this.fetch(url, {
        method,
        headers: this.headers(accept),
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (err) {
      const reason = err?.name === 'TimeoutError' ? `timeout after ${timeoutMs}ms` : err?.message;
      throw new RouterError(`Cannot reach the gateway at ${url}: ${reason}`);
    }
    const text = await res.text();
    if (!res.ok) {
      const hint = gatewayHint(res.status, text);
      throw new RouterError(`${method} ${path} -> HTTP ${res.status}: ${text.slice(0, 500)}${hint ? `\nHint: ${hint}` : ''}`, {
        status: res.status,
        body: text,
      });
    }
    const ctype = res.headers.get('content-type') || '';
    const trimmed = text.trimStart();
    if (ctype.includes('text/event-stream') || trimmed.startsWith('data:') || trimmed.startsWith('event:')) {
      return { events: parseSse(text) };
    }
    try {
      return { json: JSON.parse(text) };
    } catch {
      throw new RouterError(`${path} returned non-JSON body: ${text.slice(0, 200)}`, {
        status: res.status,
        body: text,
      });
    }
  }

  listModels() {
    return this.request('GET', '/models');
  }

  chat(body, opts) {
    return this.request('POST', '/chat/completions', { body: { stream: false, ...body }, ...opts });
  }

  responses(body, opts) {
    return this.request('POST', '/responses', { body: { stream: false, ...body }, ...opts });
  }

  // Some gateways (e.g. 9router) stream image progress as SSE when Accept allows it; ask for JSON.
  images(body, opts) {
    return this.request('POST', '/images/generations', {
      body,
      timeoutMs: this.config.imageTimeoutMs,
      accept: 'application/json',
      ...opts,
    });
  }

  // Native search endpoint (opt-in). `model` is a search provider id, not an LLM.
  search(body, opts) {
    return this.request('POST', this.config.searchPath, { body, accept: 'application/json', ...opts });
  }

  // Native fetch endpoint (opt-in). `model` is a fetch provider id (e.g. jina-reader).
  webFetch(body, opts) {
    return this.request('POST', this.config.fetchPath, { body, accept: 'application/json', ...opts });
  }
}

/**
 * @SecondBrain
 * @Description Extracts assistant text + usage from a chat-completions result, whether it came
 *   back as one JSON object or as SSE delta chunks.
 * @History:
 *   [2026-10-03 06] [Created] - Unifies JSON/SSE shapes for ask_agent and the image judge.
 */
export function chatText(result) {
  if (result.json) {
    const msg = result.json.choices?.[0]?.message ?? {};
    let content = msg.content ?? '';
    if (Array.isArray(content)) content = content.map((p) => p.text ?? '').join('');
    return { text: content, usage: result.json.usage ?? null };
  }
  let text = '';
  let usage = null;
  for (const ev of result.events ?? []) {
    text += ev.choices?.[0]?.delta?.content ?? ev.choices?.[0]?.message?.content ?? '';
    if (ev.usage) usage = ev.usage;
  }
  return { text, usage };
}

/**
 * @SecondBrain
 * @Description Normalises an OpenAI Responses API result (JSON or SSE) into
 *   `{ output: Item[], usage }` so callers can look for `message`, `web_search_call` and
 *   `image_generation_call` items in one place.
 * @History:
 *   [2026-10-03 06] [Created] - Needed by web_search and Codex image generation.
 *   [2026-10-03 09] [Updated] - Now only used by the Responses `web_search` fallback.
 */
export function responsesOutput(result) {
  if (result.json) {
    return { output: result.json.output ?? [], usage: result.json.usage ?? null };
  }
  const done = new Map();
  let completed = null;
  for (const ev of result.events ?? []) {
    if (ev.type === 'response.completed' && ev.response) completed = ev.response;
    if (ev.type === 'response.output_item.done' && ev.item) {
      done.set(ev.item.id ?? done.size, ev.item);
    }
  }
  if (completed?.output?.length) return { output: completed.output, usage: completed.usage ?? null };
  return { output: [...done.values()], usage: completed?.usage ?? null };
}
