import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { chatText } from '../router-client.mjs';

/**
 * @SecondBrain
 * @Description Sniffs the image type from magic bytes (providers do not always say).
 * @History:
 *   [2026-10-03 06] [Created] - Needed to give saved files the right extension/mimeType.
 */
export function sniffImage(buf) {
  if (buf.length >= 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) {
    return { mime: 'image/png', ext: 'png' };
  }
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return { mime: 'image/jpeg', ext: 'jpg' };
  if (buf.length >= 12 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') {
    return { mime: 'image/webp', ext: 'webp' };
  }
  return { mime: 'image/png', ext: 'png' };
}

function stripDataUri(b64) {
  const m = /^data:[^;]+;base64,(.*)$/s.exec(b64);
  return m ? m[1] : b64;
}

async function imagesApiToBuffer(ctx, json) {
  const item = json?.data?.[0];
  if (!json) throw new Error('images API answered with SSE instead of JSON');
  if (item?.b64_json) return Buffer.from(stripDataUri(item.b64_json), 'base64');
  if (item?.url) {
    if (item.url.startsWith('data:')) return Buffer.from(stripDataUri(item.url), 'base64');
    const res = await ctx.fetch(item.url, { signal: AbortSignal.timeout(ctx.config.imageTimeoutMs) });
    if (!res.ok) throw new Error(`download ${item.url} -> HTTP ${res.status}`);
    return Buffer.from(await res.arrayBuffer());
  }
  throw new Error('images API returned no data[0].b64_json/url');
}

/**
 * @SecondBrain
 * @Description True for OpenAI-style image models (gpt-image-*, gpt-*-image, dall-e-*), which
 *   accept quality/background/output_format. Other models only get prompt/size/n.
 * @History:
 *   [2026-10-03 09] [Created] - Replaces the hard-coded "Codex only" switch; matching by model
 *     name works for any gateway prefix (cx/, openai/, none).
 */
export function isOpenAiStyleImageModel(model) {
  return /(^|\/)(gpt-image|dall-e)|(^|\/)gpt-[\w.-]*image/i.test(model);
}

function imageBody(model, args) {
  const body = { model, prompt: args.prompt, n: 1 };
  // OpenAI documents response_format as unsupported for gpt-image-* (always base64).
  if (!/gpt-image/i.test(model)) body.response_format = 'b64_json';
  if (args.size && args.size !== 'auto') body.size = args.size;
  if (isOpenAiStyleImageModel(model)) {
    for (const k of ['quality', 'background', 'output_format']) {
      if (args[k] && args[k] !== 'auto') body[k] = args[k];
    }
  }
  return body;
}

/**
 * @SecondBrain
 * @Description Generates one image with any model via the OpenAI-standard
 *   /images/generations endpoint and returns `{ buf, model }`.
 * @History:
 *   [2026-10-03 06] [Created] - As generateCodexImage / generateAntigravityImage.
 *   [2026-10-03 07] [Updated] - User's 9router dashboard exposes cx/ image models directly on
 *     /v1/images/generations, so the Responses detour was removed (one call, fewer failure modes).
 *   [2026-10-03 09] [Merged] - The two vendor functions were identical apart from the param
 *     filter; one generic function keyed by model id.
 */
export async function generateImage(ctx, args, model) {
  const { json } = await ctx.client.images(imageBody(model, args));
  return { buf: await imagesApiToBuffer(ctx, json), model };
}

/**
 * @SecondBrain
 * @Description Asks a cheap vision model to score candidates so Claude can decide from a few
 *   lines of text instead of viewing every image (each viewed image ≈ 1-1.6k Claude tokens).
 * @History:
 *   [2026-10-03 06] [Created] - Optional pre-ranking; Claude keeps the final say.
 *   [2026-10-03 09] [Updated] - Judge comes from OAC_JUDGE_MODEL (default: first text model).
 */
export async function judgeImages(ctx, prompt, candidates, criteria) {
  const models = await ctx.models.resolve();
  if (!models.judge) throw new Error('no judge model (set OAC_JUDGE_MODEL or OAC_TEXT_MODELS)');
  const content = [
    {
      type: 'text',
      text:
        `You are an art director. Candidate images for the brief below are attached in order: ` +
        `${candidates.map((c) => c.id).join(', ')}.\nBrief: ${prompt}\n` +
        `Criteria: ${criteria || 'prompt adherence, composition, aesthetics, absence of artifacts (hands, text, distortions)'}.\n` +
        'Reply with JSON only: {"ranking":[{"id":"c1","score":0-10,"reason":"<= 20 words"}]} best first.',
    },
    ...candidates.map((c) => ({ type: 'image_url', image_url: { url: `data:${c.mime};base64,${c.buf.toString('base64')}` } })),
  ];
  const result = await ctx.client.chat(
    { model: models.judge, messages: [{ role: 'user', content }] },
    { timeoutMs: ctx.config.imageTimeoutMs },
  );
  const { text } = chatText(result);
  const m = /\{[\s\S]*\}/.exec(text);
  if (!m) throw new Error(`judge returned no JSON: ${text.slice(0, 200)}`);
  const parsed = JSON.parse(m[0]);
  if (!Array.isArray(parsed.ranking)) throw new Error('judge JSON has no ranking[]');
  return { model: models.judge, ranking: parsed.ranking };
}

/**
 * @SecondBrain
 * @Description Generates `n` images with one model (in parallel) and saves them. Returns
 *   `{ candidates, failures }`; never throws for a provider error.
 * @History:
 *   [2026-10-03 12] [Extracted] - Shared by the fallback and judge (fan-out) modes.
 */
async function drawWithModel(ctx, args, model, n, outDir, stamp) {
  const jobs = Array.from({ length: n }, (_, i) => ({ model, i }));
  const settled = await Promise.allSettled(
    jobs.map(async (job) => {
      const t0 = Date.now();
      const { buf } = await generateImage(ctx, args, job.model);
      if (!buf.length) throw new Error('empty image');
      const { mime, ext } = sniffImage(buf);
      const slug = job.model.replace(/[^\w.-]+/g, '_');
      const file = path.join(outDir, `${stamp}-${slug}-${job.i + 1}.${ext}`);
      await writeFile(file, buf);
      return { ...job, mime, file, buf, bytes: buf.length, ms: Date.now() - t0 };
    }),
  );
  const candidates = [];
  const failures = [];
  settled.forEach((s, k) => {
    if (s.status === 'fulfilled') candidates.push(s.value);
    else failures.push(`${jobs[k].model}#${jobs[k].i + 1}: ${s.reason?.message ?? s.reason}`);
  });
  return { candidates, failures };
}

/**
 * @SecondBrain
 * @Description MCP tool `generate_images`. Default (judge off): tries OAC_IMAGE_MODELS in order
 *   and stops at the first model that returns an image (fallback). Judge on (`judge: true` or
 *   OAC_IMAGE_JUDGE=true): every model draws in parallel and a helper vision model pre-ranks the
 *   candidates. Files are saved to disk; review=paths lets Claude open them with Read, inline
 *   embeds them in the result.
 * @History:
 *   [2026-10-03 06] [Created] - User's headline feature: both providers draw, Claude chooses.
 *   [2026-10-03 07] [Updated] - Jobs planned per model (CODEX_IMAGE_MODELS x n + Antigravity
 *     image model x n); added background/output_format; file names include the model.
 *   [2026-10-03 09] [Changed] - `providers`/`n_per_provider` renamed to `models`/`n_per_model`;
 *     models come from OAC_IMAGE_MODELS so any number of backends/vendors can compete.
 *   [2026-10-03 12] [Changed] - User asked for a judge on/off switch defaulting to off: fan-out
 *     multiplied image cost by the number of models for every request, while most requests need
 *     one usable image. Off = ordered fallback; `judge`/OAC_IMAGE_JUDGE restores fan-out + ranking.
 */
export const generateImagesTool = {
  definition: {
    name: 'generate_images',
    description:
      'Generate images and save them to disk. Default: OAC_IMAGE_MODELS are tried in order and the first model that ' +
      'succeeds is used (fallback). judge=true: every model draws in parallel and a helper vision model ranks the ' +
      'candidates (costs one generation per model). review: "paths" (open files with Read), "judge" (helper ' +
      'pre-ranks; default when judge=true), "inline" (images embedded in this result). ' +
      'Copy the chosen file into the project yourself afterwards.',
    inputSchema: {
      type: 'object',
      properties: {
        prompt: { type: 'string', description: 'Detailed image brief (subject, style, composition, colours, text).' },
        models: {
          type: 'array',
          items: { type: 'string' },
          description: 'Optional ordered subset of image model ids (default: OAC_IMAGE_MODELS).',
        },
        judge: {
          type: 'boolean',
          description: 'true = all models draw in parallel + helper ranking; false = ordered fallback. Default: OAC_IMAGE_JUDGE (false).',
        },
        n_per_model: { type: 'integer', minimum: 1, maximum: 4, default: 1, description: 'Images per model.' },
        size: { type: 'string', enum: ['auto', '1024x1024', '1536x1024', '1024x1536'], default: 'auto' },
        quality: {
          type: 'string',
          enum: ['auto', 'low', 'medium', 'high'],
          default: 'auto',
          description: 'OpenAI-style models only (gpt-image, dall-e).',
        },
        background: {
          type: 'string',
          enum: ['auto', 'opaque', 'transparent'],
          default: 'auto',
          description: 'OpenAI-style models only.',
        },
        output_format: { type: 'string', enum: ['png', 'jpeg', 'webp'], description: 'OpenAI-style models only.' },
        review: {
          type: 'string',
          enum: ['paths', 'judge', 'inline'],
          description: 'Default: "judge" when judge=true, otherwise "paths".',
        },
        judge_criteria: { type: 'string', description: 'Optional criteria for review=judge.' },
        out_dir: { type: 'string', description: 'Directory for candidates (default OAC_IMAGE_OUT_DIR).' },
      },
      required: ['prompt'],
      additionalProperties: false,
    },
  },

  async handler(ctx, args) {
    const resolved = await ctx.models.resolve();
    const models = args.models?.length ? [...new Set(args.models)] : resolved.images;
    if (!models.length) {
      return { text: 'No image models configured. Set OAC_IMAGE_MODELS (comma-separated model ids).', isError: true };
    }
    const n = Math.min(Math.max(args.n_per_model ?? 1, 1), 4);
    const judgeMode = args.judge ?? ctx.config.imageJudge;
    const review = args.review || (judgeMode ? 'judge' : 'paths');
    const outDir = path.resolve(args.out_dir || ctx.config.imageOutDir);
    await mkdir(outDir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');

    const found = [];
    const failures = [];
    let planned = 0;
    if (judgeMode) {
      planned = models.length * n;
      const runs = await Promise.all(models.map((model) => drawWithModel(ctx, args, model, n, outDir, stamp)));
      for (const r of runs) {
        found.push(...r.candidates);
        failures.push(...r.failures);
      }
    } else {
      planned = n;
      for (const model of models) {
        const r = await drawWithModel(ctx, args, model, n, outDir, stamp);
        found.push(...r.candidates);
        failures.push(...r.failures);
        if (r.candidates.length) break;
      }
    }
    const candidates = found.map((c, k) => ({ id: `c${k + 1}`, ...c }));

    const mode = judgeMode
      ? `judge (${models.length} models in parallel)`
      : 'fallback (first model that succeeds; judge=true compares all models)';
    const lines = [`Brief: ${args.prompt}`, `Mode: ${mode}`, `Candidates (${candidates.length}/${planned}) saved in ${outDir}:`];
    for (const c of candidates) {
      lines.push(`- ${c.id} · ${c.model} · ${(c.bytes / 1024).toFixed(0)} KB · ${c.ms}ms · ${c.file}`);
    }
    if (failures.length) lines.push('Failures:', ...failures.map((f) => `- ${f}`));
    if (!candidates.length) return { text: lines.join('\n'), isError: true };

    const content = [];
    if (review === 'judge' && candidates.length > 1) {
      try {
        const { model, ranking } = await judgeImages(ctx, args.prompt, candidates, args.judge_criteria);
        lines.push(`Judge (${model}) ranking — advisory, you decide:`);
        for (const r of ranking) {
          const c = candidates.find((x) => x.id === r.id);
          lines.push(`- ${r.id} score ${r.score}: ${r.reason}${c ? ` (${c.model})` : ''}`);
        }
        lines.push('Read the top file only if you need to confirm, then copy the winner into the project.');
      } catch (err) {
        lines.push(`Judge failed (${err.message}); fall back to viewing files with Read.`);
      }
    } else if (review === 'inline') {
      for (const c of candidates) {
        if (c.bytes > ctx.config.maxInlineImageBytes) {
          lines.push(`(${c.id} not inlined: ${c.bytes} B > OAC_MAX_INLINE_IMAGE_BYTES; use Read on the path)`);
          continue;
        }
        content.push({ type: 'text', text: c.id }, { type: 'image', data: c.buf.toString('base64'), mimeType: c.mime });
      }
      lines.push('Pick the best id, then copy its file into the project.');
    } else {
      lines.push('Open candidates with the Read tool to compare, pick the best, then copy it into the project.');
    }
    return { text: lines.join('\n'), content };
  },
};
