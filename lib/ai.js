// Pluggable AI provider.
//   cursor-agent (default): Cursor CLI on the user's Cursor subscription (no API key)
//   claude-code: Claude Code CLI on the user's Claude Pro/Max subscription (no API key)
//   anthropic: Anthropic Messages API (ANTHROPIC_API_KEY)
//   gemini:    Google Gemini API (GEMINI_API_KEY)
//   MOCK=1 / demo mode: offline mock content
// Per-request overrides come from UI headers (keys stored only in the browser's localStorage).
const anthropic = require('./anthropic');
const gemini = require('./gemini');
const claudeCode = require('./claude-code');
const cursorAgent = require('./cursor-agent');

const PROVIDERS = ['cursor-agent', 'claude-code', 'anthropic', 'gemini'];
const LABEL = { 'cursor-agent': 'Cursor subscription (Cursor CLI)', 'claude-code': 'Claude subscription (Claude Code)', anthropic: 'Anthropic API', gemini: 'Gemini API' };

function resolve(req) {
  const h = (n) => (req.headers[n] || '').toString().trim();
  const mock = process.env.MOCK === '1' || h('x-golu-mock') === '1';
  const anthropicKey = h('x-anthropic-key') || process.env.ANTHROPIC_API_KEY || '';
  const geminiKey = h('x-gemini-key') || process.env.GEMINI_API_KEY || '';
  let provider = (h('x-ai-provider') || process.env.AI_PROVIDER || '').toLowerCase();
  if (!PROVIDERS.includes(provider)) provider = 'cursor-agent';
  const key = provider === 'gemini' ? geminiKey : provider === 'anthropic' ? anthropicKey : 'subscription';
  // CLI providers (cursor-agent, claude-code) authenticate through their own login, not a key.
  const overrides = { text: h('x-text-model') || undefined, code: h('x-code-model') || undefined, image: h('x-image-model') || undefined };
  return { mock, provider, key, overrides };
}

const libFor = (p) => (p === 'gemini' ? gemini : p === 'anthropic' ? anthropic : p === 'cursor-agent' ? cursorAgent : claudeCode);
const isCli = (p) => p === 'cursor-agent' || p === 'claude-code';

// Returns null when ready, else a user-facing reason.
async function notReady(ctx) {
  if (ctx.mock) return null;
  if (ctx.provider === 'cursor-agent') {
    const s = await cursorAgent.status();
    if (!s.installed) return 'Cursor CLI is not installed. Run `curl https://cursor.com/install -fsS | bash`, then `cursor-agent login` (see the setup card on the home screen).';
    if (s.loggedIn === false) return 'Cursor CLI is not signed in. Run `cursor-agent login` in Terminal and sign in with your Cursor account.';
    return null;
  }
  if (ctx.provider === 'claude-code') {
    const s = await claudeCode.status();
    if (!s.installed) return 'Claude Code CLI is not installed. Run `npm install -g @anthropic-ai/claude-code`, then `claude` once to sign in (see the setup card on the home screen).';
    if (s.loggedIn === false) return 'Claude Code is not signed in. Run `claude` in a terminal and sign in with your Claude app account.';
    return null;
  }
  if (!ctx.key) return `No ${ctx.provider === 'gemini' ? 'Gemini' : 'Anthropic'} API key. Add it in Settings (gear) or .env, switch to the Claude subscription provider, or turn on Demo mode.`;
  return null;
}

async function models(ctx) {
  if (ctx.mock) return { text: 'mock', code: 'mock', image: null, textCandidates: [], imageCandidates: [], error: null };
  if (!isCli(ctx.provider) && !ctx.key) return { text: null, code: null, image: null, textCandidates: [], imageCandidates: [], error: `No ${ctx.provider === 'gemini' ? 'Gemini' : 'Anthropic'} API key set` };
  return libFor(ctx.provider).chooseModels(ctx.key, ctx.overrides);
}

function client(ctx) {
  const lib = libFor(ctx.provider);
  let chosen = null;
  const get = async () => (chosen ||= await models(ctx));
  return {
    ctx,
    models: get,
    notReady: () => notReady(ctx),
    async text(opts, which = 'text') {
      const why = await notReady(ctx);
      if (why) throw Object.assign(new Error(why), { status: 401 });
      const m = await get();
      return lib.generateText(ctx.key, which === 'code' ? m.code : m.text, opts);
    },
  };
}

module.exports = { resolve, models, client, notReady, PROVIDERS, LABEL, isCli };
