import { askAgentTool, clip } from './text.mjs';
import { webFetchTool, webSearchTool } from './web.mjs';
import { generateImagesTool } from './images.mjs';
import { unadvertised } from '../models.mjs';

/**
 * @SecondBrain
 * @Description MCP tool `list_helper_models`: shows the model ids the connector uses for each
 *   role, the optional search/fetch routes, and the ids advertised by GET /models.
 * @History:
 *   [2026-10-03 06] [Created] - Lets the user/Claude verify auto-discovery without reading logs.
 *   [2026-10-03 07] [Updated] - Also prints search/fetch provider order; registered web_fetch.
 *   [2026-10-03 09] [Refactored] - Vendor-neutral: no cx/ ag/ filter; lists every advertised id
 *     (clipped) and points at the OAC_* variable behind each role.
 *   [2026-10-03 11] [Updated] - Warns about configured model ids that /models does not advertise
 *     (user feedback: an id with the wrong prefix made one failover slot fail on every call).
 */
export const listModelsTool = {
  definition: {
    name: 'list_helper_models',
    description: 'Show which helper model ids are configured for each role and which ids the backend advertises.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  async handler(ctx) {
    const m = await ctx.models.resolve();
    const { config } = ctx;
    const show = (v) => (Array.isArray(v) ? v.join(', ') : v) || '(not set)';
    const roles = [
      `- text (OAC_TEXT_MODELS${config.textModels.length ? '' : ', auto-picked'}): ${show(m.text)}`,
      `- images (OAC_IMAGE_MODELS): ${show(m.images)}`,
      `- judge (OAC_JUDGE_MODEL): ${show(m.judge)}`,
      `- search providers (OAC_SEARCH_PROVIDERS → POST ${config.searchPath}): ${show(config.searchProviders)}`,
      `- search model (OAC_SEARCH_MODEL, Responses web_search): ${show(m.search)}`,
      `- fetch providers (OAC_FETCH_PROVIDERS → POST ${config.fetchPath}): ${show(config.fetchProviders) === '(not set)' ? '(local fetch)' : show(config.fetchProviders)}`,
    ];
    const avail = ctx.models.available;
    const availText = avail.length
      ? avail.join(', ')
      : `(none — ${ctx.models.discoveryError ?? 'GET /models returned no ids'})`;
    // Search provider ids are not LLMs, so only model roles are checked.
    const missing = unadvertised([...m.text, ...m.images, m.judge, m.search], avail);
    const warn = missing.length
      ? `\n\n⚠️ Configured but not advertised by GET /models (check the spelling/prefix, or the call will fail): ${missing.join(', ')}`
      : '';
    return {
      text: clip(`Backend: ${config.baseUrl || '(OAC_BASE_URL not set)'}\nRoles:\n${roles.join('\n')}${warn}\n\nAdvertised models (${avail.length}):\n${availText}`, config.maxResultChars),
    };
  },
};

// Kept deliberately small: every tool definition is re-sent to Claude on every turn.
export const TOOLS = [askAgentTool, webSearchTool, webFetchTool, generateImagesTool, listModelsTool];
