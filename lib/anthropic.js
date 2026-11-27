// Anthropic Claude Messages API client (streaming, so long H5 generations never hit request timeouts).
// Key goes in the x-api-key header and is never logged.
const BASE = (process.env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com').replace(/\/$/, '') + '/v1';
const VERSION = '2023-06-01';
const DEFAULT_TEXT = 'claude-sonnet-4-5';
const DEFAULT_CODE = 'claude-sonnet-4-5';

class AIError extends Error { constructor(msg, status) { super(msg); this.status = status; } }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const headers = (key) => ({ 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': VERSION });

const modelCache = new Map();
const keyHash = (k) => require('crypto').createHash('sha256').update(k).digest('hex').slice(0, 12);

async function listModels(key) {
  const h = keyHash(key);
  const c = modelCache.get(h);
  if (c && Date.now() - c.at < 10 * 60 * 1000) return c.models;
  const res = await fetch(`${BASE}/models?limit=1000`, { headers: headers(key) });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw new AIError(`Anthropic ${res.status}: ${j?.error?.message || res.statusText}`, res.status);
  const models = j.data || [];
  modelCache.set(h, { at: Date.now(), models });
  return models;
}

// Newest first by created_at; family ranking used as a tie-breaker.
function rankFamily(models, family) {
  return models
    .filter((m) => m.id.includes(family))
    .sort((a, b) => (Date.parse(b.created_at || 0) - Date.parse(a.created_at || 0)) || b.id.localeCompare(a.id));
}

async function chooseModels(key, overrides = {}) {
  let sonnets = [], opuses = [], all = [], error = null;
  try {
    const models = await listModels(key);
    all = models.slice().sort((a, b) => Date.parse(b.created_at || 0) - Date.parse(a.created_at || 0)).map((m) => m.id);
    sonnets = rankFamily(models, 'sonnet');
    opuses = rankFamily(models, 'opus');
  } catch (e) { error = e.message; }
  const text = overrides.text || process.env.ANTHROPIC_TEXT_MODEL || sonnets[0]?.id || opuses[0]?.id || all[0] || DEFAULT_TEXT;
  // Code generation: newest Opus if it is at least as new as the newest Sonnet, else newest Sonnet.
  let codeAuto = sonnets[0]?.id || DEFAULT_CODE;
  if (opuses[0] && (!sonnets[0] || Date.parse(opuses[0].created_at) >= Date.parse(sonnets[0].created_at) - 90 * 864e5)) codeAuto = opuses[0].id;
  const code = overrides.code || process.env.ANTHROPIC_CODE_MODEL || codeAuto;
  return { text, code, image: null, textCandidates: all.slice(0, 20), imageCandidates: [], error };
}

async function generateText(key, model, { prompt, system, images = [], temperature = 0.9, maxTokens = 8192, timeoutMs = 900000, json = false }) {
  if (!key) throw new AIError('No Anthropic API key. Add ANTHROPIC_API_KEY to .env or paste it in Settings (gear icon).', 401);
  const content = [
    ...images.map((im) => ({ type: 'image', source: { type: 'base64', media_type: im.mime || 'image/png', data: im.data } })),
    { type: 'text', text: prompt + (json ? '\n\nRespond with ONLY valid JSON, no prose, no code fences.' : '') },
  ];
  const body = { model, max_tokens: maxTokens, temperature, stream: true, messages: [{ role: 'user', content }] };
  if (system) body.system = system;
  let lastErr;
  for (let attempt = 0; attempt < 3; attempt++) {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), timeoutMs);
    try {
      const res = await fetch(`${BASE}/messages`, { method: 'POST', headers: headers(key), body: JSON.stringify(body), signal: ctl.signal });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        const err = new AIError(`Anthropic ${res.status}: ${j?.error?.message || res.statusText}`, res.status);
        if ([429, 500, 502, 503, 529].includes(res.status) && attempt < 2) { lastErr = err; await sleep(3000 * (attempt + 1) ** 2); continue; }
        throw err;
      }
      let out = '', stop = null, buf = '';
      const dec = new TextDecoder();
      for await (const chunk of res.body) {
        buf += dec.decode(chunk, { stream: true });
        let i;
        while ((i = buf.indexOf('\n')) >= 0) {
          const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
          if (!line.startsWith('data:')) continue;
          let ev; try { ev = JSON.parse(line.slice(5)); } catch { continue; }
          if (ev.type === 'content_block_delta' && ev.delta?.type === 'text_delta') out += ev.delta.text;
          else if (ev.type === 'message_delta' && ev.delta?.stop_reason) stop = ev.delta.stop_reason;
          else if (ev.type === 'error') throw new AIError(`Anthropic stream error: ${ev.error?.message}`, 502);
        }
      }
      if (!out) throw new AIError(`Claude returned no text (stop_reason: ${stop})`, 502);
      if (stop === 'max_tokens') out += '\n<!-- truncated: max_tokens -->';
      if (json) return require('./gemini').extractJson(out);
      return out;
    } catch (e) {
      if (e.name === 'AbortError') e = new AIError(`Claude request timed out after ${Math.round(timeoutMs / 1000)}s`, 504);
      if (e instanceof AIError && ![429, 500, 502, 503, 504, 529].includes(e.status)) throw e;
      lastErr = e;
      if (attempt < 2) await sleep(3000 * (attempt + 1) ** 2);
    } finally { clearTimeout(t); }
  }
  throw lastErr;
}

module.exports = { AIError, listModels, chooseModels, generateText };
