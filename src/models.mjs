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
