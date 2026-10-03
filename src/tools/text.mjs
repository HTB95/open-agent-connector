import { chatText } from '../router-client.mjs';

export const HELPER_SYSTEM =
  'You are a helper sub-agent working for a lead software engineer (another AI). ' +
  'Return ONLY the result the lead needs: dense, factual, no greetings, no restating the task, ' +
  'no filler. Prefer bullet points and code blocks. If unsure, say so explicitly instead of guessing.';

/**
 * @SecondBrain
 * @Description Caps any text returned to Claude at `max` chars. Every char returned costs
 *   Claude input tokens, so this is the main FinOps guard of the connector.
 * @History:
 *   [2026-10-03 06] [Created] - Prevent a chatty helper from flooding Claude's context.
 */
export function clip(text, max) {
  if (!text || text.length <= max) return text ?? '';
  return `${text.slice(0, max)}\n\n…[truncated ${text.length - max} chars by open-agent-connector; ask a narrower question]`;
}

/**
 * @SecondBrain
 * @Description Runs one chat completion on the given model id and returns
 *   `{ model, text, usage, ms }`.
 * @History:
 *   [2026-10-03 06] [Created] - Shared by ask_agent (single/auto/both) and web_search fallback.
 *   [2026-10-03 07] [Updated] - Also used by web_fetch to digest pages so Claude gets a summary.
 *   [2026-10-03 09] [Refactored] - Takes a concrete model id instead of a vendor name
 *     (codex/antigravity), so any backend/model works.
 */
export async function runModel(ctx, model, { prompt, system, maxTokens }) {
  const t0 = Date.now();
  const result = await ctx.client.chat({
    model,
    messages: [
      { role: 'system', content: system ? `${HELPER_SYSTEM}\n\n${system}` : HELPER_SYSTEM },
      { role: 'user', content: prompt },
    ],
    ...(maxTokens ? { max_tokens: maxTokens } : {}),
  });
  const { text, usage } = chatText(result);
  if (!text.trim()) throw new Error(`${model} returned an empty answer`);
  return { model, text, usage, ms: Date.now() - t0 };
}

export const NO_TEXT_MODEL =
  'No text model available: set OAC_TEXT_MODELS (comma-separated model ids, failover order) or check that ' +
  'GET /models works on OAC_BASE_URL.';

/**
 * @SecondBrain
 * @Description Tries the configured text models in order until one answers. Throws with every
 *   model's error when all fail.
 * @History:
 *   [2026-10-03 09] [Created] - Replaces AUTO_ORDER: the order of OAC_TEXT_MODELS is the
 *     failover order, one less setting to explain.
 */
export async function runWithFailover(ctx, req, models) {
  const list = models ?? (await ctx.models.resolve()).text;
  if (!list.length) throw new Error(NO_TEXT_MODEL);
  const errors = [];
  for (const model of list) {
    try {
      return await runModel(ctx, model, req);
    } catch (err) {
      errors.push(`${model}: ${err.message}`);
    }
  }
  throw new Error(`all text models failed:\n- ${errors.join('\n- ')}`);
}

function formatAnswer(r, max) {
  const usage = r.usage ? ` · tokens in/out ${r.usage.prompt_tokens ?? '?'}/${r.usage.completion_tokens ?? '?'}` : '';
  return `### ${r.model} (${r.ms}ms${usage})\n${clip(r.text, max)}`;
}

/**
 * @SecondBrain
 * @Description MCP tool `ask_agent`: delegate a self-contained text chore to a helper model.
 *   `auto` walks OAC_TEXT_MODELS with failover; `all` asks every configured model in parallel
 *   so Claude can cross-check; any other value is used as a literal model id.
 * @History:
 *   [2026-10-03 06] [Created] - Core token-offloading primitive; Claude stays the decision maker.
 *   [2026-10-03 09] [Changed] - Param `agent` (auto/codex/antigravity/both) renamed to `model`
 *     (auto/all/<model id>) for the vendor-neutral open-source release.
 */
export const askAgentTool = {
  definition: {
    name: 'ask_agent',
    description:
      'Delegate a self-contained chore to a cheaper helper model to save Claude tokens: summarising docs/logs, drafting ' +
      'boilerplate, translating, brainstorming, explaining an API. Give full context in `prompt` (helpers cannot see the ' +
      'repo). You remain responsible for verifying the answer.',
    inputSchema: {
      type: 'object',
      properties: {
        prompt: { type: 'string', description: 'Complete, self-contained task for the helper.' },
        model: {
          type: 'string',
          default: 'auto',
          description:
            '"auto" = first healthy model in OAC_TEXT_MODELS; "all" = every configured text model in parallel; ' +
            'or an exact model id (see list_helper_models).',
        },
        system: { type: 'string', description: 'Optional extra instructions (format, length, persona).' },
        max_tokens: { type: 'integer', minimum: 16, description: 'Optional output cap for the helper.' },
      },
      required: ['prompt'],
      additionalProperties: false,
    },
  },

  async handler(ctx, args) {
    const choice = args.model || 'auto';
    const req = { prompt: args.prompt, system: args.system, maxTokens: args.max_tokens };
    const max = ctx.config.maxResultChars;
    const { text: models } = await ctx.models.resolve();

    if (choice === 'all') {
      if (!models.length) return { text: NO_TEXT_MODEL, isError: true };
      const settled = await Promise.allSettled(models.map((m) => runModel(ctx, m, req)));
      const parts = settled.map((s, i) =>
        s.status === 'fulfilled'
          ? formatAnswer(s.value, Math.floor(max / models.length))
          : `### ${models[i]} FAILED\n${s.reason?.message ?? s.reason}`,
      );
      return { text: parts.join('\n\n'), isError: settled.every((s) => s.status === 'rejected') };
    }

    try {
      const r = await runWithFailover(ctx, req, choice === 'auto' ? models : [choice]);
      return { text: formatAnswer(r, max) };
    } catch (err) {
      return { text: `ask_agent failed: ${err.message}`, isError: true };
    }
  },
};
