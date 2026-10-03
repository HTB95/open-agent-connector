/**
 * @SecondBrain
 * @Description Ids that are clearly not general chat models; skipped when auto-picking a text
 *   model from GET /models.
 * @History:
 *   [2026-10-03 09] [Created] - Replaces the vendor-specific (cx/, ag/) preference tables:
 *     a generic gateway can expose any naming scheme, so we only filter out obvious non-chat ids.
 */
export const NON_CHAT_MODEL = /image|dall-e|imagen|embed|tts|whisper|transcri|audio|speech|moderation|rerank|search|fetch|video|veo|sora/i;

/**
 * @SecondBrain
 * @Description Picks a default text model when OAC_TEXT_MODELS is empty: the first advertised id
 *   that does not look like an image/audio/embedding model. Returns null if none qualifies.
 * @History:
 *   [2026-10-03 06] [Created] - `pickModel` with per-vendor family regexes.
 *   [2026-10-03 09] [Replaced] - Generic heuristic; explicit OAC_TEXT_MODELS is the
 *     recommended setup, auto-pick only keeps a zero-config first run working.
 */
export function pickDefaultTextModel(ids) {
  return ids.find((id) => !NON_CHAT_MODEL.test(id)) ?? null;
}

export const IMAGE_MODEL = /image|dall-e|imagen|flux|stable-diffusion|sdxl/i;

/**
 * @SecondBrain
 * @Description Proposes OAC_TEXT_MODELS / OAC_IMAGE_MODELS values from the ids GET /models
 *   advertises: up to `max` chat-looking ids and up to `max` image-looking ids, in the order the
 *   backend lists them. A starting point for the user to reorder, not a quality ranking.
 * @History:
 *   [2026-10-03 12] [Created] - User asked for an easier setup that their own Claude can do:
 *     `doctor` now prints ready-to-paste model lists, so only the URL and key must be known.
 */
export function suggestModels(ids, max = 3) {
  return {
    text: ids.filter((id) => !NON_CHAT_MODEL.test(id) && !IMAGE_MODEL.test(id)).slice(0, max),
    images: ids.filter((id) => IMAGE_MODEL.test(id)).slice(0, max),
  };
}

/**
 * @SecondBrain
 * @Description Returns the configured ids that GET /models does not advertise. Returns [] when
 *   the advertised list is empty (discovery failed or the backend has no /models), because then
 *   nothing can be concluded.
 * @History:
 *   [2026-10-03 11] [Created] - User feedback: a typo'd id (e.g. `ag/gemini-2.5-flash` when the
 *     gateway only had `xkr/google/gemini-2.5-flash`) sat in OAC_TEXT_MODELS and failed on every
 *     failover; list_helper_models/doctor should point it out.
 */
export function unadvertised(ids, available) {
  if (!available.length) return [];
  const known = new Set(available);
  return [...new Set(ids.filter(Boolean))].filter((id) => !known.has(id));
}

/**
 * @SecondBrain
 * @Description Resolves (and caches) the concrete model ids for every role. Env config wins;
 *   GET /models is called once per process to auto-pick a text model and to power
 *   list_helper_models.
 * @History:
 *   [2026-10-03 06] [Created] - One /v1/models call per session instead of per tool call.
 *   [2026-10-03 09] [Refactored] - Roles are now generic lists (text, images) instead of
 *     codex/antigravity slots.
 */
export class ModelResolver {
  constructor(config, client) {
    this.config = config;
    this.client = client;
    this.cache = null;
    this.available = [];
    this.discoveryError = null;
  }

  async discover() {
    try {
      const { json } = await this.client.listModels();
      this.available = (json?.data ?? []).map((m) => m.id).filter(Boolean);
    } catch (err) {
      this.available = [];
      this.discoveryError = err.message;
    }
  }

  async resolve() {
    if (this.cache) return this.cache;
    await this.discover();
    let text = this.config.textModels;
    if (!text.length) {
      const picked = pickDefaultTextModel(this.available);
      text = picked ? [picked] : [];
    }
    this.cache = {
      text,
      images: this.config.imageModels,
      judge: this.config.judgeModel || text[0] || null,
      search: this.config.searchModel || null,
    };
    return this.cache;
  }
}
