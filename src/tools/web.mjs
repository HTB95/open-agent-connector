import { responsesOutput } from '../router-client.mjs';
import { HELPER_SYSTEM, clip, runWithFailover } from './text.mjs';

/**
 * @SecondBrain
 * @Description Pulls answer text + cited URLs out of a Responses API `output` array.
 * @History:
 *   [2026-10-03 06] [Created] - Citations are what make delegated search trustworthy for Claude.
 *   [2026-10-03 07] [Moved] - From text.mjs to web.mjs; now only used by the Codex fallback.
 *   [2026-10-03 09] [Updated] - Serves the generic OAC_SEARCH_MODEL Responses fallback.
 */
export function extractSearchAnswer(output) {
  let text = '';
  const sources = new Map();
  let searched = false;
  for (const item of output) {
    if (item.type === 'web_search_call') searched = true;
    if (item.type !== 'message') continue;
    for (const part of item.content ?? []) {
      if (part.type !== 'output_text') continue;
      text += part.text ?? '';
      for (const ann of part.annotations ?? []) {
        if (ann.type === 'url_citation' && ann.url) sources.set(ann.url, ann.title || ann.url);
      }
    }
  }
  return { text, sources: [...sources].map(([url, title]) => ({ url, title })), searched };
}

/**
 * @SecondBrain
 * @Description Formats a native search payload (`{ provider, answer?, results[] }`, the 9router shape) into a
 *   compact digest: grounded answer first, then numbered sources with short snippets.
 * @History:
 *   [2026-10-03 07] [Created] - Keep search output small; snippets capped at 200 chars each.
 */
export function formatSearchResult(data, max) {
  const answer = data.answer?.text?.trim() ?? '';
  const results = (data.results ?? []).filter((r) => r.url);
  const src = results
    .map((r, i) => {
      const snip = (r.snippet || '').replace(/\s+/g, ' ').trim().slice(0, 200);
      return `${i + 1}. ${r.title || r.url} — ${r.url}${snip ? `\n   ${snip}` : ''}`;
    })
    .join('\n');
  return clip([answer, src ? `Sources:\n${src}` : ''].filter(Boolean).join('\n\n'), max);
}

async function responsesSearch(ctx, model, query, focus) {
  const result = await ctx.client.responses({
    model,
    instructions: `${HELPER_SYSTEM}\nSearch the web, then answer with a compact digest (max ~300 words) and cite sources.${focus ? `\nFocus: ${focus}` : ''}`,
    input: query,
    tools: [{ type: 'web_search' }],
  });
  const { text, sources, searched } = extractSearchAnswer(responsesOutput(result).output);
  if (!text.trim()) throw new Error('empty answer');
  if (!searched) throw new Error('model did not perform a web_search_call');
  const src = sources.length ? `\n\nSources:\n${sources.map((s) => `- ${s.title}: ${s.url}`).join('\n')}` : '';
  return `${clip(text, ctx.config.maxResultChars)}${src}`;
}

/**
 * @SecondBrain
 * @Description MCP tool `web_search`. Order: native search endpoint with OAC_SEARCH_PROVIDERS
 *   (opt-in, e.g. 9router `antigravity` = Google Search grounding) -> Responses API
 *   `web_search` tool on OAC_SEARCH_MODEL (opt-in) -> non-live answer from a text model that is
 *   LOUDLY labelled as such.
 * @History:
 *   [2026-10-03 06] [Created] - Codex Responses web_search only.
 *   [2026-10-03 07] [Updated] - User asked to prefer Antigravity: use 9router's native
 *     /v1/search (provider "antigravity") first; Codex becomes the fallback.
 *   [2026-10-03 09] [Refactored] - Both live routes are now opt-in config, not hard-coded
 *     vendors, so the tool works (degraded, clearly labelled) on plain chat-only backends.
 *   [2026-10-03 11] [Updated] - Description tells Claude to use its own search for current facts
 *     when the result is not live (user feedback: non-live answers must not stand in for fresh data).
 */
export const webSearchTool = {
  definition: {
    name: 'web_search',
    description:
      'Live web search done by helpers. Returns a short grounded answer + source URLs instead of raw pages, saving ' +
      'Claude tokens. Use for docs, error messages, versions, news. If the result starts with "NOT A LIVE SEARCH", ' +
      'treat it as possibly outdated and use your own search for current facts.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'What to find out. Be specific (versions, dates, error text).' },
        focus: { type: 'string', description: 'Optional: what the answer should concentrate on.' },
        max_results: { type: 'integer', minimum: 1, maximum: 10, default: 5 },
      },
      required: ['query'],
      additionalProperties: false,
    },
  },

  async handler(ctx, args) {
    const max = ctx.config.maxResultChars;
    const query = args.focus ? `${args.query} (focus: ${args.focus})` : args.query;
    const errors = [];
    for (const provider of ctx.config.searchProviders) {
      const t0 = Date.now();
      try {
        const { json } = await ctx.client.search({ model: provider, query, max_results: args.max_results ?? 5 });
        if (!json?.answer?.text?.trim() && !json?.results?.length) throw new Error('no results');
        return { text: `[live search · ${json.provider || provider} · ${Date.now() - t0}ms]\n${formatSearchResult(json, max)}` };
      } catch (err) {
        errors.push(`${provider}: ${err.message}`);
      }
    }
    const { search: searchModel } = await ctx.models.resolve();
    if (searchModel) {
      try {
        const text = await responsesSearch(ctx, searchModel, args.query, args.focus);
        return { text: `[live search · responses web_search (${searchModel})]\n${text}` };
      } catch (err) {
        errors.push(`${searchModel}: ${err.message}`);
      }
    }
    if (!errors.length) errors.push('no live search route configured (OAC_SEARCH_PROVIDERS / OAC_SEARCH_MODEL)');
    try {
      const r = await runWithFailover(ctx, { prompt: query });
      return {
        text:
          `⚠️ NOT A LIVE SEARCH — ${errors.join(' | ')}. ` +
          `Answer below is from ${r.model}'s training data and may be outdated:\n\n${clip(r.text, max)}`,
      };
    } catch (err) {
      return { text: `web_search failed: ${[...errors, `fallback: ${err.message}`].join(' | ')}`, isError: true };
    }
  },
};

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

/**
 * @SecondBrain
 * @Description Dependency-free HTML -> readable text (drops script/style/nav chrome, keeps
 *   block breaks). Good enough for a helper LLM to digest; not a full readability engine.
 * @History:
 *   [2026-10-03 07] [Created] - Local fallback when no 9router fetch provider is connected.
 *   [2026-10-03 09] [Updated] - Now the default path: native fetch endpoints are opt-in.
 */
export function htmlToText(html) {
  const title = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1]?.trim() ?? null;
  const text = html
    .replace(/<(script|style|noscript|svg|head|nav|footer|iframe)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(br|\/p|\/div|\/h[1-6]|\/li|\/tr|\/section|\/article)[^>]*>/gi, '\n')
    .replace(/<li[^>]*>/gi, '\n- ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&(#x?[0-9a-f]+|\w+);/gi, (m, e) => {
      if (e[0] === '#') {
        const code = e[1].toLowerCase() === 'x' ? Number.parseInt(e.slice(2), 16) : Number.parseInt(e.slice(1), 10);
        return Number.isFinite(code) ? String.fromCodePoint(code) : m;
      }
      return ENTITIES[e.toLowerCase()] ?? m;
    })
    .replace(/[ \t\f\v\r]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return { title, text };
}

async function fetchLocally(ctx, url) {
  const res = await ctx.fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (open-agent-connector)', Accept: 'text/html,text/plain,application/json,*/*' },
    redirect: 'follow',
    signal: AbortSignal.timeout(ctx.config.textTimeoutMs),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const ctype = res.headers.get('content-type') || '';
  if (!/text|json|xml|markdown/.test(ctype)) throw new Error(`unsupported content-type ${ctype}`);
  const body = await res.text();
  return /html/.test(ctype) ? htmlToText(body) : { title: null, text: body };
}

/**
 * @SecondBrain
 * @Description MCP tool `web_fetch`: read one URL. Content comes from a native fetch endpoint
 *   (OAC_FETCH_PROVIDERS, opt-in) or a local fetch; when `question` is given a helper text
 *   model reads the whole page and Claude only receives the answer.
 * @History:
 *   [2026-10-03 07] [Created] - Antigravity has no fetch provider in 9router, so "Antigravity
 *     first" here means Antigravity digests the page — that is where the token saving is.
 *   [2026-10-03 09] [Refactored] - Digest uses OAC_TEXT_MODELS failover; vendor names removed.
 */
export const webFetchTool = {
  definition: {
    name: 'web_fetch',
    description:
      'Read a web page. With `question`, a helper model reads the full page and returns only the answer — ' +
      'far cheaper than loading the page into Claude. Without it, returns cleaned page text (capped).',
    inputSchema: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'http(s) URL to read.' },
        question: { type: 'string', description: 'What to extract/answer from the page (recommended).' },
      },
      required: ['url'],
      additionalProperties: false,
    },
  },

  async handler(ctx, args) {
    if (!/^https?:\/\//i.test(args.url)) return { text: 'url must start with http:// or https://', isError: true };
    const max = ctx.config.maxResultChars;
    const errors = [];
    let page = null;
    let via = '';
    for (const provider of ctx.config.fetchProviders) {
      try {
        const { json } = await ctx.client.webFetch({ model: provider, url: args.url, format: 'markdown' });
        if (!json?.content?.text) throw new Error('empty content');
        page = { title: json.title, text: json.content.text };
        via = `fetch provider ${json.provider || provider}`;
        break;
      } catch (err) {
        errors.push(`${provider}: ${err.message}`);
      }
    }
    if (!page) {
      try {
        page = await fetchLocally(ctx, args.url);
        via = 'local fetch';
      } catch (err) {
        errors.push(`local: ${err.message}`);
        return { text: `web_fetch failed: ${errors.join(' | ')}`, isError: true };
      }
    }
    const header = `[${via} · ${page.title ?? args.url} · ${page.text.length} chars]`;
    if (!args.question) return { text: `${header}\n${clip(page.text, max)}` };

    // Cap to keep the helper call fast and within typical long-context limits.
    const prompt = `Page: ${args.url}\nTitle: ${page.title ?? '-'}\n\n<page>\n${page.text.slice(0, 400_000)}\n</page>\n\nQuestion: ${args.question}`;
    try {
      const r = await runWithFailover(ctx, { prompt, system: 'Answer only from the page content; quote exact values.' });
      return { text: `${header} · digested by ${r.model}\n${clip(r.text, max)}` };
    } catch (err) {
      errors.push(err.message);
    }
    return { text: `${header}\nHelpers failed (${errors.join(' | ')}); raw text:\n${clip(page.text, max)}`, isError: false };
  },
};
