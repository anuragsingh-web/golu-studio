// "claude-code" provider: shells out to the Claude Code CLI in headless print mode, so generations
// run on the user's Claude Pro/Max subscription (log in once with `claude` -> /login). No API key.
//
// Invocation (per call):
//   claude -p --input-format stream-json --output-format stream-json --verbose
//          --tools "" --max-turns 1 --no-session-persistence
//          --system-prompt-file <tmp> [--model <alias|id>]
// The user message (text + optional base64 image block) is written to stdin as one stream-json line.
// If stream-json input isn't supported by the installed CLI, we fall back to plain text on stdin with
// --output-format json (the image is then replaced by a text description).
const { spawn, execFile } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

class AIError extends Error { constructor(msg, status) { super(msg); this.status = status; } }
const IS_WIN = process.platform === 'win32';
const WORKDIR = path.join(os.tmpdir(), 'golu-claude-work'); // empty cwd => no CLAUDE.md / project settings picked up
const MAX_CONCURRENCY = Math.max(1, Number(process.env.CLAUDE_CODE_CONCURRENCY || 2));
const LOGIN_HELP = 'Claude Code is not signed in. Open a terminal, run `claude`, and sign in with your Claude app (Pro/Max) account, then retry.';

// ---------- locate the CLI ----------
let cliCache = null;
function candidates() {
  const home = os.homedir();
  const list = [process.env.CLAUDE_CLI_PATH];
  if (IS_WIN) {
    const appdata = process.env.APPDATA || path.join(home, 'AppData', 'Roaming');
    list.push(path.join(home, '.local', 'bin', 'claude.exe'), path.join(appdata, 'npm', 'claude.cmd'), path.join(process.env.LOCALAPPDATA || '', 'Programs', 'claude', 'claude.exe'));
  } else {
    list.push(path.join(home, '.local', 'bin', 'claude'), path.join(home, '.claude', 'local', 'claude'), '/opt/homebrew/bin/claude', '/usr/local/bin/claude', '/usr/bin/claude', path.join(home, '.npm-global', 'bin', 'claude'));
  }
  return list.filter(Boolean);
}
function whichClaude() {
  const dirs = (process.env.PATH || '').split(path.delimiter);
  const names = IS_WIN ? ['claude.exe', 'claude.cmd', 'claude.bat', 'claude'] : ['claude'];
  for (const d of dirs) for (const n of names) { const p = path.join(d, n); try { if (fs.statSync(p).isFile()) return p; } catch {} }
  return candidates().find((p) => { try { return fs.statSync(p).isFile(); } catch { return false; } }) || null;
}
function cliPath() { if (!cliCache || !fs.existsSync(cliCache)) cliCache = whichClaude(); return cliCache; }

// Windows .cmd/.bat shims must go through the shell; quote args ourselves.
function spawnCli(args, opts) {
  const exe = cliPath();
  if (!exe) throw new AIError('Claude Code CLI not found. Install it with `npm install -g @anthropic-ai/claude-code`, then run `claude` once to sign in.', 503);
  if (IS_WIN && /\.(cmd|bat)$/i.test(exe)) {
    const q = (a) => (a === '' ? '""' : /[\s"&|<>^()%!]/.test(a) ? `"${a.replace(/"/g, '""')}"` : a);
    return spawn(`"${exe}" ${args.map(q).join(' ')}`, [], { ...opts, shell: true, windowsHide: true });
  }
  return spawn(exe, args, { ...opts, windowsHide: true });
}

function childEnv() {
  const env = { ...process.env };
  delete env.ANTHROPIC_API_KEY; // force the subscription login, never an API key from Golu's .env
  delete env.ANTHROPIC_AUTH_TOKEN;
  if (!env.CLAUDE_CODE_MAX_OUTPUT_TOKENS) env.CLAUDE_CODE_MAX_OUTPUT_TOKENS = '64000';
  env.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC = env.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC || '1';
  env.NO_COLOR = '1';
  return env;
}

function killTree(child) {
  try {
    if (IS_WIN) execFile('taskkill', ['/pid', String(child.pid), '/T', '/F'], () => {});
    else { try { process.kill(-child.pid, 'SIGKILL'); } catch { child.kill('SIGKILL'); } }
  } catch {}
}

function run(args, { input = '', timeoutMs = 60000 } = {}) {
  return new Promise((resolve, reject) => {
    fs.mkdirSync(WORKDIR, { recursive: true });
    let child;
    try { child = spawnCli(args, { cwd: WORKDIR, env: childEnv(), detached: !IS_WIN, stdio: ['pipe', 'pipe', 'pipe'] }); } catch (e) { return reject(e); }
    let out = '', err = '', done = false;
    const t = setTimeout(() => { if (!done) { done = true; killTree(child); reject(new AIError(`Claude Code timed out after ${timeoutMs >= 60000 ? `${Math.round(timeoutMs / 6000) / 10} min` : `${Math.round(timeoutMs / 1000)} s`} (raise CLAUDE_CODE_TIMEOUT_MIN in .env for very long builds)`, 504)); } }, timeoutMs);
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (err += d));
    child.on('error', (e) => { if (!done) { done = true; clearTimeout(t); reject(new AIError(`Could not start Claude Code: ${e.message}`, 503)); } });
    child.on('close', (code) => { if (!done) { done = true; clearTimeout(t); resolve({ code, out, err }); } });
    child.stdin.on('error', () => {});
    child.stdin.end(input);
  });
}

// ---------- concurrency limit ----------
let active = 0; const waiters = [];
async function withSlot(fn) {
  if (active >= MAX_CONCURRENCY) await new Promise((r) => waiters.push(r));
  active++;
  try { return await fn(); } finally { active--; const n = waiters.shift(); if (n) n(); }
}

// ---------- status ----------
let statusCache = null;
async function status({ fresh = false } = {}) {
  if (statusCache && !fresh && Date.now() - statusCache.at < 60000) return statusCache.value;
  const exe = cliPath();
  let value = { installed: !!exe, path: exe, version: null, loggedIn: null, authMethod: null, account: null, error: null, concurrency: MAX_CONCURRENCY };
  if (exe) {
    try {
      const v = await run(['--version'], { timeoutMs: 20000 });
      value.version = (v.out || v.err).trim().split('\n')[0] || null;
      if (v.code !== 0) value.error = (v.err || v.out).trim().slice(0, 200);
    } catch (e) { value.error = e.message; }
    try { // `claude auth status` prints JSON and exits 0 when logged in, 1 when not (newer CLIs)
      const a = await run(['auth', 'status'], { timeoutMs: 20000 });
      let j = null; try { j = JSON.parse(a.out.trim()); } catch {}
      if (j) {
        value.authMethod = j.authMethod || null;
        value.loggedIn = a.code === 0 && j.authMethod !== 'none' && j.loggedIn !== false;
        value.account = j.email || j.account?.email || j.organization || null;
        if (value.authMethod === 'api_key') value.note = 'Claude Code is using an API key, not your subscription. Run `claude auth login` to switch.';
      } else if (/unknown command|error: unknown|usage:/i.test(a.out + a.err)) value.loggedIn = null; // older CLI: unknown
      else value.loggedIn = a.code === 0 ? true : /not logged|login|none/i.test(a.out + a.err) ? false : null;
    } catch { value.loggedIn = null; }
  }
  statusCache = { at: Date.now(), value };
  return value;
}

async function chooseModels(_key, overrides = {}) {
  return {
    text: overrides.text || process.env.CLAUDE_CODE_TEXT_MODEL || 'sonnet',
    code: overrides.code || process.env.CLAUDE_CODE_CODE_MODEL || 'opus',
    image: null, textCandidates: ['sonnet', 'opus', 'haiku'], imageCandidates: [], error: null,
  };
}

// ---------- output parsing ----------
function parseOutput(stdout) {
  const s = stdout.trim();
  let result = null, isError = false, subtype = null, texts = [];
  const handle = (o) => {
    if (!o || typeof o !== 'object') return;
    if (Array.isArray(o)) return o.forEach(handle); // some versions print a JSON array of messages
    if (o.type === 'result') { result = typeof o.result === 'string' ? o.result : result; isError = !!o.is_error || /^error/.test(o.subtype || ''); subtype = o.subtype; }
    else if (o.type === 'assistant' && o.message?.content) for (const c of o.message.content) if (c.type === 'text') texts.push(c.text);
  };
  try { handle(JSON.parse(s)); } catch {
    for (const line of s.split(/\r?\n/)) { const l = line.trim(); if (!l.startsWith('{')) continue; try { handle(JSON.parse(l)); } catch {} }
  }
  const text = result ?? (texts.length ? texts.join('\n') : null);
  return { text, isError, subtype };
}

function classify(msg) {
  if (/login|log in|not authenticated|authentication|invalid api key|oauth|unauthori[sz]ed|credit balance/i.test(msg)) return new AIError(`${LOGIN_HELP} (${msg.slice(0, 160)})`, 401);
  if (/usage limit|rate limit|limit reached|5-hour|quota/i.test(msg)) return new AIError(`Claude subscription usage limit reached: ${msg.slice(0, 200)}. Wait for the limit to reset, or switch the code model to "sonnet" in Settings.`, 429);
  if (/model/i.test(msg) && /not (found|available|supported)|invalid|access/i.test(msg)) return Object.assign(new AIError(`Model not available on this Claude plan: ${msg.slice(0, 200)}`, 400), { modelError: true });
  return new AIError(`Claude Code error: ${msg.slice(0, 300)}`, 502);
}

let streamJsonUnsupported = false;
async function invoke({ model, system, prompt, images, timeoutMs }) {
  const sysFile = path.join(os.tmpdir(), `golu-sys-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}.txt`);
  fs.writeFileSync(sysFile, system || 'You are a helpful assistant. Answer directly with the requested content only.');
  const base = ['-p', '--tools', '', '--max-turns', '1', '--no-session-persistence', '--system-prompt-file', sysFile];
  if (model) base.push('--model', model);
  try {
    if (!streamJsonUnsupported) {
      const content = [...images.map((im) => ({ type: 'image', source: { type: 'base64', media_type: im.mime || 'image/png', data: im.data } })), { type: 'text', text: prompt }];
      const line = JSON.stringify({ type: 'user', message: { role: 'user', content } }) + '\n';
      const r = await run([...base, '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose'], { input: line, timeoutMs });
      const p = parseOutput(r.out);
      if (p.text && !p.isError) return p.text;
      const msg = (p.text || r.err || r.out || `exit code ${r.code}`).trim();
      if (/input-format|stream-json|unknown option|unexpected argument/i.test(r.err) && !p.text) { streamJsonUnsupported = true; }
      else throw classify(msg);
    }
    // Fallback: plain text on stdin, single JSON result on stdout.
    const textPrompt = images.length ? `${prompt}\n\n(Reference screenshot unavailable in this mode: follow the concept's art direction and palette closely.)` : prompt;
    const r = await run([...base, '--output-format', 'json'], { input: textPrompt, timeoutMs });
    const p = parseOutput(r.out);
    if (p.text && !p.isError) return p.text;
    throw classify((p.text || r.err || r.out || `exit code ${r.code}`).trim());
  } finally { fs.rm(sysFile, { force: true }, () => {}); }
}

async function generateText(_key, model, { prompt, system, images = [], json = false, timeoutMs }) {
  const st = await status();
  if (!st.installed) throw new AIError('Claude Code CLI not found. Install it with `npm install -g @anthropic-ai/claude-code`, then run `claude` once and sign in with your Claude app account.', 503);
  if (st.loggedIn === false) throw new AIError(LOGIN_HELP, 401);
  const full = prompt + (json ? '\n\nRespond with ONLY valid JSON, no prose, no code fences.' : '');
  const to = timeoutMs || (Number(process.env.CLAUDE_CODE_TIMEOUT_MIN || 0) * 60000) || 10 * 60000;
  const out = await withSlot(async () => {
    try { return await invoke({ model, system, prompt: full, images, timeoutMs: to }); } catch (e) {
      if (e.modelError && model && model !== 'sonnet') return invoke({ model: 'sonnet', system, prompt: full, images, timeoutMs: to }); // e.g. Opus not on this plan
      throw e;
    }
  });
  if (json) return require('./gemini').extractJson(out);
  return out;
}

module.exports = { AIError, status, chooseModels, generateText, cliPath, parseOutput };
