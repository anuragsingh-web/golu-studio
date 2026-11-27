// Gemini REST client: model discovery, text (JSON) and image generation. The API key is sent
// via the x-goog-api-key header and is never logged.
const BASE = 'https://generativelanguage.googleapis.com/v1beta';
const DEFAULT_TEXT = 'gemini-2.5-pro';
const DEFAULT_IMAGE = 'gemini-2.5-flash-image';

class GeminiError extends Error {
  constructor(msg, status) { super(msg); this.status = status; }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function call(key, pathPart, body, { timeoutMs = 300000, method = 'POST', retries = 2 } = {}) {
  if (!key) throw new GeminiError('No Gemini API key. Add GEMINI_API_KEY to .env or paste it in Settings (gear icon).', 401);
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), timeoutMs);
    try {
      const res = await fetch(`${BASE}/${pathPart}`, {
        method,
        headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
        body: body ? JSON.stringify(body) : undefined,
        signal: ctl.signal,
      });
      const text = await res.text();
      let json; try { json = JSON.parse(text); } catch { json = null; }
      if (!res.ok) {
        const msg = json?.error?.message || text.slice(0, 300) || res.statusText;
        const err = new GeminiError(`Gemini ${res.status}: ${msg}`, res.status);
        if ([429, 500, 502, 503, 504].includes(res.status) && attempt < retries) { lastErr = err; await sleep(2000 * (attempt + 1) ** 2); continue; }
        throw err;
      }
      return json;
    } catch (e) {
      if (e.name === 'AbortError') e = new GeminiError(`Gemini request timed out after ${Math.round(timeoutMs / 1000)}s`, 504);
      if (e instanceof GeminiError && ![429, 500, 502, 503, 504].includes(e.status)) throw e;
      lastErr = e;
      if (attempt < retries) await sleep(2000 * (attempt + 1) ** 2);
    } finally { clearTimeout(t); }
  }
  throw lastErr;
}

// ---------- model discovery ----------
const modelCache = new Map(); // keyHash -> {at, models}
const keyHash = (k) => require('crypto').createHash('sha256').update(k).digest('hex').slice(0, 12);

async function listModels(key) {
  const h = keyHash(key);
  const c = modelCache.get(h);
  if (c && Date.now() - c.at < 10 * 60 * 1000) return c.models;
  let models = [], pageToken = '';
  do {
    const j = await call(key, `models?pageSize=1000${pageToken ? `&pageToken=${pageToken}` : ''}`, null, { method: 'GET', timeoutMs: 20000, retries: 1 });
    models = models.concat(j.models || []);
    pageToken = j.nextPageToken || '';
  } while (pageToken);
  modelCache.set(h, { at: Date.now(), models });
  return models;
}

function versionOf(name) {
  const m = name.match(/gemini-(\d+)(?:\.(\d+))?/);
  return m ? Number(m[1]) + Number(m[2] || 0) / 10 : 0;
}

function scoreText(name) {
  if (/image|tts|audio|live|embed|vision|robotics|computer-use|aqa|learnlm|gemma|native|thinking-exp|deep-research/.test(name)) return -1;
  const v = versionOf(name);
  if (!v) return -1;
  let s = v * 10;
  if (/-pro/.test(name)) s += 5; else if (/flash-lite|lite/.test(name)) s += 0; else if (/flash/.test(name)) s += 2;
  if (/preview/.test(name)) s -= 0.3;
  if (/exp/.test(name)) s -= 1.5;
  if (/\d{2}-\d{2}$|-\d{3}$/.test(name)) s -= 0.2; // dated snapshots slightly below aliases
  return s;
}
function scoreImage(name) {
  if (!/image/.test(name) || /imagen|edit|tts/.test(name)) return -1;
  let s = versionOf(name) * 10;
  if (/-pro/.test(name)) s += 5;
  if (/preview/.test(name)) s -= 0.3;
  if (/exp|generation/.test(name)) s -= 3;
  return s;
}

function pick(models, scorer) {
  const ranked = models
    .filter((m) => (m.supportedGenerationMethods || []).includes('generateContent'))
    .map((m) => ({ id: m.name.replace(/^models\//, ''), display: m.displayName, s: scorer(m.name.replace(/^models\//, '')) }))
    .filter((m) => m.s >= 0)
    .sort((a, b) => b.s - a.s);
  return ranked;
}

async function chooseModels(key, overrides = {}) {
  let textCandidates = [], imageCandidates = [], error = null;
  try {
    const models = await listModels(key);
    textCandidates = pick(models, scoreText);
    imageCandidates = pick(models, scoreImage);
  } catch (e) { error = e.message; }
  return {
    text: overrides.text || process.env.GEMINI_TEXT_MODEL || textCandidates[0]?.id || DEFAULT_TEXT,
    code: overrides.code || process.env.GEMINI_CODE_MODEL || overrides.text || process.env.GEMINI_TEXT_MODEL || textCandidates[0]?.id || DEFAULT_TEXT,
    image: overrides.image || process.env.GEMINI_IMAGE_MODEL || imageCandidates[0]?.id || DEFAULT_IMAGE,
    textCandidates: textCandidates.slice(0, 15).map((m) => m.id),
    imageCandidates: imageCandidates.slice(0, 10).map((m) => m.id),
    error,
  };
}

// ---------- generation ----------
function partsText(json) {
  const parts = json?.candidates?.[0]?.content?.parts || [];
  return parts.filter((p) => p.text && !p.thought).map((p) => p.text).join('');
}

function extractJson(s) {
  const fenced = s.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = fenced ? fenced[1] : s;
  try { return JSON.parse(body); } catch {}
  const a = body.indexOf('{'), b = body.lastIndexOf('}');
  const a2 = body.indexOf('['), b2 = body.lastIndexOf(']');
  if (a2 >= 0 && (a < 0 || a2 < a)) { try { return JSON.parse(body.slice(a2, b2 + 1)); } catch {} }
  if (a >= 0) return JSON.parse(body.slice(a, b + 1));
  throw new Error('Model did not return JSON');
}

async function generateText(key, model, { prompt, system, json = false, images = [], temperature = 0.9, maxTokens = 8192, timeoutMs }) {
  const parts = [...images.map((im) => ({ inlineData: { mimeType: im.mime || 'image/png', data: im.data } })), { text: prompt }];
  const body = {
    contents: [{ role: 'user', parts }],
    generationConfig: { temperature, maxOutputTokens: maxTokens, ...(json ? { responseMimeType: 'application/json' } : {}) },
  };
  if (system) body.systemInstruction = { parts: [{ text: system }] };
  const j = await call(key, `models/${model}:generateContent`, body, { timeoutMs: timeoutMs || 300000 });
  const out = partsText(j);
  if (!out) {
    const fr = j?.candidates?.[0]?.finishReason || j?.promptFeedback?.blockReason || 'unknown';
    throw new GeminiError(`Gemini returned no text (finishReason: ${fr})`, 502);
  }
  return json ? extractJson(out) : out;
}

async function generateImage(key, model, { prompt, refs = [], aspect = '1:1' }) {
  const parts = [...refs.map((im) => ({ inlineData: { mimeType: im.mime || 'image/png', data: im.data } })), { text: prompt }];
  const mk = (withCfg) => ({
    contents: [{ role: 'user', parts }],
    generationConfig: { responseModalities: ['TEXT', 'IMAGE'], ...(withCfg ? { imageConfig: { aspectRatio: aspect } } : {}) },
  });
  let j;
  try {
    j = await call(key, `models/${model}:generateContent`, mk(true), { timeoutMs: 180000 });
  } catch (e) {
    if (e.status === 400 && /imageConfig|aspect/i.test(e.message)) j = await call(key, `models/${model}:generateContent`, mk(false), { timeoutMs: 180000 });
    else throw e;
  }
  const ps = j?.candidates?.[0]?.content?.parts || [];
  const img = ps.find((p) => (p.inlineData || p.inline_data) && !p.thought) || ps.find((p) => p.inlineData || p.inline_data);
  if (!img) {
    const fr = j?.candidates?.[0]?.finishReason || j?.promptFeedback?.blockReason || 'no image part';
    throw new GeminiError(`Image model returned no image (${fr}). ${partsText(j).slice(0, 200)}`, 502);
  }
  const d = img.inlineData || img.inline_data;
  return { mime: d.mimeType || d.mime_type || 'image/png', data: d.data };
}

module.exports = { GeminiError, chooseModels, listModels, generateText, generateImage, extractJson };
