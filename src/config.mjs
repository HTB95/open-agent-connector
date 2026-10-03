import os from 'node:os';
import path from 'node:path';

/**
 * @SecondBrain
 * @Description Reads every runtime setting from `OAC_*` env vars once. The connector is
 *   backend-agnostic: any OpenAI-compatible gateway or provider works (9router, LiteLLM,
 *   OpenRouter, OpenAI, ...). Helpers are identified purely by model id; nothing is hard-coded
 *   to a specific vendor.
 * @History:
 *   [2026-10-03 06] [Created] - Central place for 9router URL/key, model overrides and
 *     token-budget caps; model ids are optional because they are auto-discovered.
 *   [2026-10-03 07] [Updated] - Default port 12121 (user's 9router), Codex images now via
 *     /v1/images/generations (CODEX_IMAGE_MODELS), added SEARCH_PROVIDERS/FETCH_PROVIDERS with
 *     Antigravity first, as the user asked to prefer Antigravity for web search.
 *   [2026-10-03 09] [Refactored] - Open-source release: 9router was only the author's example.
 *     Replaced NINEROUTER_* / CODEX_* / ANTIGRAVITY_* with generic OAC_* vars, helpers became
 *     ordered model-id lists, search/fetch endpoints became opt-in, and the base URL has no
 *     default (a user-specific port is a wrong default for everyone else).
 *   [2026-10-03 12] [Added] - OAC_IMAGE_JUDGE (default false): user asked for image models to run
 *     as an ordered fallback by default and only fan out + judge when explicitly enabled, since
 *     one image per request is what most chores need and every extra model costs a generation.
 */
export function loadConfig(env = process.env) {
  const int = (v, d) => {
    const n = Number.parseInt(v ?? '', 10);
    return Number.isFinite(n) && n > 0 ? n : d;
  };
  const list = (v) =>
    (v ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
  const urlPath = (v, d) => `/${(v || d).replace(/^\/+/, '')}`;

  return {
    baseUrl: (env.OAC_BASE_URL || '').trim().replace(/\/+$/, ''),
    apiKey: env.OAC_API_KEY || '',
    // Ordered: `ask_agent auto` and page digests try them in this order (failover).
    // Empty => one chat model is auto-picked from GET /models (see models.mjs).
    textModels: list(env.OAC_TEXT_MODELS),
    // Ordered. Default: fallback (first model that succeeds wins). OAC_IMAGE_JUDGE=true: every
    // listed model draws in parallel and a helper vision model ranks the candidates.
    imageModels: list(env.OAC_IMAGE_MODELS),
    imageJudge: /^(1|true|yes|on)$/i.test((env.OAC_IMAGE_JUDGE ?? '').trim()),
    // Vision-capable chat model used by generate_images review="judge". Empty => first text model.
    judgeModel: env.OAC_JUDGE_MODEL || '',
    // Optional native search endpoint (e.g. 9router POST /v1/search). `model` = provider id.
    searchProviders: list(env.OAC_SEARCH_PROVIDERS),
    searchPath: urlPath(env.OAC_SEARCH_PATH, '/search'),
    // Optional model that supports the Responses API `web_search` tool (OpenAI-style).
    searchModel: env.OAC_SEARCH_MODEL || '',
    // Optional native fetch endpoint (e.g. 9router POST /v1/web/fetch). Empty => fetch locally.
    fetchProviders: list(env.OAC_FETCH_PROVIDERS),
    fetchPath: urlPath(env.OAC_FETCH_PATH, '/web/fetch'),
    imageOutDir: env.OAC_IMAGE_OUT_DIR || path.join(os.tmpdir(), 'open-agent-connector', 'images'),
    // Hard caps that protect Claude's context window (= Claude tokens).
    maxResultChars: int(env.OAC_MAX_RESULT_CHARS, 12000),
    maxInlineImageBytes: int(env.OAC_MAX_INLINE_IMAGE_BYTES, 1_500_000),
    textTimeoutMs: int(env.OAC_TEXT_TIMEOUT_MS, 120_000),
    imageTimeoutMs: int(env.OAC_IMAGE_TIMEOUT_MS, 240_000),
  };
}
