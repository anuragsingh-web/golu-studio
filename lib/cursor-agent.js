// "cursor-agent" provider: shells out to the Cursor CLI (`agent` / `cursor-agent`) in headless print
// mode, so generations run on the user's Cursor subscription. Auth is either `cursor-agent login`
// (local) or the CURSOR_API_KEY env var / --api-key flag (headless / hosted).
//
// Invocation (per call, in a fresh empty temp workspace):
//   cursor-agent -p --output-format json --mode ask --trust --workspace <tmp> [--model <id>] "<prompt>"
//  - --mode ask   = read-only Q&A mode (no file edits / shell); no --force, so nothing needing approval runs.
//  - The Cursor CLI has no system-prompt flag or image input flag: the system prompt is prepended to the
//    prompt, and a reference image is copied into the temp workspace and referenced by path (the agent can
//    read images via its read tool). The concept's art direction is always in the text too.
//  - Model ids are account-specific and drift, so they are discovered with `--list-models` and the newest
//    Claude Sonnet (text) / Claude Opus (code) are chosen; unknown/plan-gated models fall back to `auto`.
const { spawn, execFile } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

class AIError extends Error { constructor(msg, status) { super(msg); this.status = status; } }
const IS_WIN = process.platform === 'win32';
const MAX_CONCURRENCY = Math.max(1, Number(process.env.CURSOR_AGENT_CONCURRENCY || 2));
const LOGIN_HELP = 'Cursor CLI is not signed in. Set CURSOR_API_KEY (from Cursor Dashboard → API Keys at https://cursor.com/dashboard/api), or run `cursor-agent login` locally, then click Re-check.';
const INSTALL_HELP = 'Cursor CLI not found. Install it with `curl https://cursor.com/install -fsS | bash`, then set CURSOR_API_KEY or run `cursor-agent login`.';
const stripAnsi = (s) => String(s || '').replace(/\x1b\[[0-9;?]*[ -\/]*[@-~]/g, '').replace(/\r/g, '');
function apiKey() { return String(process.env.CURSOR_API_KEY || '').trim(); }
function withAuthArgs(args) { const k = apiKey(); return k ? ['--api-key', k, ...args] : args; }

// ---------- locate the CLI ----------
function isFile(p) { try { return fs.statSync(p).isFile(); } catch { return false; } }
function candidateList() {
  const home = os.homedir();
  const exts = IS_WIN ? ['.exe', '.cmd', '.ps1', ''] : [''];
  const out = [];
  if (process.env.CURSOR_CLI_PATH) out.push({ p: process.env.CURSOR_CLI_PATH, verify: false });
  const local = [path.join(home, '.local', 'bin'), path.join(home, '.cursor', 'bin'), '/opt/homebrew/bin', '/usr/local/bin'];
  if (IS_WIN) local.push(path.join(process.env.LOCALAPPDATA || '', 'cursor-agent'), path.join(home, 'AppData', 'Local', 'cursor-agent'));
  const pathDirs = (process.env.PATH || '').split(path.delimiter).filter(Boolean);
  // `cursor-agent` is unambiguous; the newer short name `agent` is common, so verify it's Cursor's.
  for (const d of [...local, ...pathDirs]) for (const e of exts) out.push({ p: path.join(d, `cursor-agent${e}`), verify: false });
  for (const d of [...local, ...pathDirs]) for (const e of exts) out.push({ p: path.join(d, `agent${e}`), verify: true });
  return out;
}
let cliCache = null;
async function cliPath({ fresh = false } = {}) {
  if (cliCache && !fresh && isFile(cliCache)) return cliCache;
  cliCache = null;
  const seen = new Set();
  for (const c of candidateList()) {
    if (seen.has(c.p) || !isFile(c.p)) continue; seen.add(c.p);
    if (!c.verify) { cliCache = c.p; break; }
    try { // an `agent` binary must look like the Cursor CLI
      const r = await run(c.p, ['--version'], { timeoutMs: 15000 });
      const real = (() => { try { return fs.realpathSync(c.p); } catch { return c.p; } })();
      if (/cursor/i.test(real) || /^\d{4}\.\d{1,2}\.\d{1,2}/.test(stripAnsi(r.out).trim())) { cliCache = c.p; break; }
    } catch {}
  }
  return cliCache;
}

function spawnCli(exe, args, opts) {
  if (IS_WIN && /\.(cmd|bat|ps1)$/i.test(exe)) {
    const q = (a) => (a === '' ? '""' : /[\s"&|<>^()%!]/.test(a) ? `"${a.replace(/"/g, '""')}"` : a);
    return spawn(`"${exe}" ${args.map(q).join(' ')}`, [], { ...opts, shell: true, windowsHide: true });
  }
  return spawn(exe, args, { ...opts, windowsHide: true });
}
function killTree(child) {
  try {
    if (IS_WIN) execFile('taskkill', ['/pid', String(child.pid), '/T', '/F'], () => {});
    else { try { process.kill(-child.pid, 'SIGKILL'); } catch { child.kill('SIGKILL'); } }
  } catch {}
}
function run(exe, args, { timeoutMs = 60000, cwd } = {}) {
  return new Promise((resolve, reject) => {
    let child;
    const env = { ...process.env, NO_COLOR: '1', FORCE_COLOR: '0', CI: '1' };
    const key = apiKey();
    if (key) env.CURSOR_API_KEY = key;
    try { child = spawnCli(exe, withAuthArgs(args), { cwd: cwd || os.tmpdir(), env, detached: !IS_WIN, stdio: ['ignore', 'pipe', 'pipe'] }); } catch (e) { return reject(new AIError(`Could not start Cursor CLI: ${e.message}`, 503)); }
    let out = '', err = '', done = false;
    const t = setTimeout(() => { if (!done) { done = true; killTree(child); reject(new AIError(`Cursor CLI timed out after ${timeoutMs >= 60000 ? `${Math.round(timeoutMs / 6000) / 10} min` : `${Math.round(timeoutMs / 1000)} s`} (raise CURSOR_AGENT_TIMEOUT_MIN in .env for very long builds)`, 504)); } }, timeoutMs);
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (err += d));
    child.on('error', (e) => { if (!done) { done = true; clearTimeout(t); reject(new AIError(`Could not start Cursor CLI: ${e.message}`, 503)); } });
    child.on('close', (code) => { if (!done) { done = true; clearTimeout(t); resolve({ code, out: stripAnsi(out), err: stripAnsi(err) }); } });
  });
}

// ---------- concurrency ----------
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
  const exe = await cliPath({ fresh });
  const value = { installed: !!exe, path: exe, version: null, loggedIn: null, account: null, error: null, concurrency: MAX_CONCURRENCY };
  if (exe) {
    try { const v = await run(exe, ['--version'], { timeoutMs: 20000 }); value.version = (v.out || v.err).trim().split('\n')[0] || null; } catch (e) { value.error = e.message; }
    try {
      let r = await run(exe, ['status', '--format', 'json'], { timeoutMs: 30000 });
      let j = null; try { j = JSON.parse(r.out.trim()); } catch {}
      if (!j && /unknown option|unknown argument|--format/i.test(r.err + r.out)) r = await run(exe, ['status'], { timeoutMs: 30000 });
      const txt = `${r.out}\n${r.err}`;
      if (j) {
        const flag = j.isAuthenticated ?? j.authenticated ?? j.loggedIn ?? j.logged_in;
        value.account = j.email || j.userEmail || j.user?.email || j.account?.email || null;
        value.loggedIn = typeof flag === 'boolean' ? flag : value.account ? true : /not|none|unauth/i.test(JSON.stringify(j)) ? false : r.code === 0;
      } else if (/not (logged|signed|authenticated)|unauthenticated|please (log|sign) ?in|login required|run .*login/i.test(txt)) value.loggedIn = false;
      else if (/logged in|signed in|authenticated|@/i.test(txt) && r.code === 0) { value.loggedIn = true; value.account = (txt.match(/[\w.+-]+@[\w-]+\.[\w.]+/) || [])[0] || null; }
      else value.loggedIn = r.code === 0 ? null : false;
    } catch (e) { value.loggedIn = null; value.error = value.error || e.message; }
    // `agent status` often only reflects a browser login. A set CURSOR_API_KEY is enough
    // for headless auth (Cursor docs: env var or --api-key), so treat it as signed in.
    if (apiKey()) {
      value.loggedIn = true;
      value.authMethod = 'api-key';
      if (!value.account) value.account = 'API key';
    }
  }
  statusCache = { at: Date.now(), value };
  return value;
}

// ---------- models ----------
let modelsCache = null;
async function listModels() {
  if (modelsCache && Date.now() - modelsCache.at < 30 * 60000) return modelsCache.ids;
  const exe = await cliPath();
  if (!exe) return [];
  let r = await run(exe, ['--list-models'], { timeoutMs: 45000 }).catch(() => null);
  if (!r || r.code !== 0 || !r.out.trim()) r = await run(exe, ['models'], { timeoutMs: 45000 }).catch(() => null);
  const ids = [];
  for (const line of (r?.out || '').split('\n')) {
    const m = line.trim().replace(/^[-*•]\s*/, '').match(/^([a-z0-9][a-z0-9._\-\[\]=,]*)(?:\s+[-–—:]\s+|\s{2,}|\s*\(|$)/i);
    if (m && /[a-z]/i.test(m[1]) && !/^(available|models?|id|name)$/i.test(m[1])) ids.push(m[1]);
  }
  modelsCache = { at: Date.now(), ids: [...new Set(ids)] };
  return modelsCache.ids;
}
function claudeVersion(id, fam) {
  const rest = id.toLowerCase().replace('claude', '').replace(fam, ' ');
  const m = rest.match(/(\d+)(?:[.-](\d)(?!\d))?/);
  return m ? Number(m[1]) + Number(m[2] || 0) / 10 : 0;
}
function isSlowVariant(id) {
  const s = String(id).toLowerCase();
  return /thinking/.test(s) || /(?:^|[-._])(high|xhigh|max)(?:[-._]|$)/.test(s);
}
function pickClaude(ids, fam, effortPref) {
  // Defaults skip slow "-high" / "thinking" / "max" variants (H5 builds timed out on opus-*-high).
  const c = ids.filter((id) => new RegExp(`(^|[-.])${fam}([-.]|$)`, 'i').test(id) && !/fast|max|xhigh|1m|context|\[/i.test(id) && !isSlowVariant(id));
  const effortScore = (id) => { const i = effortPref.findIndex((e) => (e === '' ? !/-(low|medium|high|thinking)/i.test(id) : id.toLowerCase().includes(e))); return i < 0 ? 0 : effortPref.length - i; };
  c.sort((a, b) => claudeVersion(b, fam) - claudeVersion(a, fam) || effortScore(b) - effortScore(a));
  return c[0] || null;
}
async function chooseModels(_key, overrides = {}) {
  let ids = [], error = null;
  try { ids = await listModels(); } catch (e) { error = e.message; }
  // Prefer plain newest Opus for code (then Sonnet, then auto). Text/art: plain or medium Sonnet.
  const sonnet = pickClaude(ids, 'sonnet', ['', '-medium', '-low']);
  const opus = pickClaude(ids, 'opus', ['', '-medium', '-low']);
  return {
    text: overrides.text || process.env.CURSOR_AGENT_TEXT_MODEL || sonnet || (ids.length ? 'auto' : 'sonnet-4.5'),
    code: overrides.code || process.env.CURSOR_AGENT_CODE_MODEL || opus || sonnet || (ids.length ? 'auto' : 'opus-4.5'),
    image: null,
    textCandidates: ids.filter((id) => /claude|sonnet|opus|auto|composer|gpt|gemini/i.test(id)).slice(0, 60),
    imageCandidates: [], error, discovered: ids.length,
  };
}

// ---------- invocation ----------
function parseOutput(stdout) {
  const s = stdout.trim();
  const pick = (o) => (o && o.type === 'result' ? o : null);
  try { const o = JSON.parse(s); if (pick(o)) return { text: o.result, isError: !!o.is_error }; } catch {}
  let res = null; const texts = [];
  for (const l of s.split('\n')) { if (!l.trim().startsWith('{')) continue; try { const o = JSON.parse(l); if (o.type === 'result') res = o; else if (o.type === 'assistant' && !o.timestamp_ms) for (const c of o.message?.content || []) if (c.type === 'text') texts.push(c.text); } catch {} }
  if (res) return { text: res.result, isError: !!res.is_error };
  if (texts.length) return { text: texts.join('\n'), isError: false };
  return { text: s || null, isError: false, raw: true };
}
function classify(msg) {
  if (/Cannot use this model|Named models unavailable|Free plans can only|model .*not (available|found|supported)/i.test(msg)) return Object.assign(new AIError(`Model not available on this Cursor account: ${msg.slice(0, 200)}`, 400), { modelError: true });
  if (/not (logged|signed) in|unauthori[sz]ed|authenticat|please log ?in|cursor-agent login|agent login/i.test(msg)) return new AIError(`${LOGIN_HELP} (${msg.slice(0, 140)})`, 401);
  if (/usage limit|rate limit|quota|too many requests|limit reached|out of (fast )?requests/i.test(msg)) return new AIError(`Cursor usage limit reached: ${msg.slice(0, 200)}. Wait and retry, or switch the code model to a cheaper one in Settings.`, 429);
  if (/headless mode/i.test(msg)) return new AIError(`Your Cursor team has disabled CLI headless mode: ${msg.slice(0, 200)}`, 403);
  return new AIError(`Cursor CLI error: ${msg.slice(0, 300)}`, 502);
}

async function invoke(exe, { model, system, prompt, images, files = [], timeoutMs }) {
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'golu-cursor-'));
  try {
    let refs = '';
    // Extra input files (Rate My Game): copied into the workspace so the agent can open them with its read tool.
    // `{ name, path }` or `{ name, data }` (Buffer/string). Placeholders {{WS}} in the prompt become the workspace path.
    for (const f of files) {
      const dest = path.join(ws, f.name);
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      if (f.path) fs.copyFileSync(f.path, dest); else fs.writeFileSync(dest, f.data);
    }
    if (files.length) prompt = prompt.split('{{WS}}').join(ws);
    images.forEach((im, i) => {
      const f = `reference-${i + 1}.${/jpe?g/.test(im.mime || '') ? 'jpg' : 'png'}`;
      fs.writeFileSync(path.join(ws, f), Buffer.from(im.data, 'base64'));
      refs += `\n- ./${f} (absolute path: ${path.join(ws, f)})`;
    });
    let body = `${system ? `<system_instructions>\n${system}\n</system_instructions>\n\n` : ''}` +
      'You are being called as a pure text generator from a script. Do NOT create, edit or delete files and do NOT run commands. Reply with the requested content directly in your answer.' +
      (refs ? `\nA reference screenshot of the intended look is saved in the workspace. Open/view it with your read tool before answering (if you cannot view images, rely on the written art direction):${refs}` : '') +
      `\n\n${prompt}`;
    if (Buffer.byteLength(body) > 200000) { // very long prompts (e.g. H5 fix rounds): hand over via a file
      fs.writeFileSync(path.join(ws, 'prompt.md'), body);
      body = `Read the file ./prompt.md in the workspace (absolute path: ${path.join(ws, 'prompt.md')}) and follow its instructions exactly. Do not create or edit any files; reply with the requested content directly.`;
    }
    const args = ['-p', '--output-format', 'json', '--mode', 'ask', '--trust', '--workspace', ws];
    if (model) args.push('--model', model);
    args.push(body);
    const r = await run(exe, args, { timeoutMs, cwd: ws });
    const p = parseOutput(r.out);
    if (r.code === 0 && p.text && !p.isError) return p.text;
    throw classify((r.err || p.text || `exit code ${r.code}`).trim());
  } finally { fs.rm(ws, { recursive: true, force: true }, () => {}); }
}

async function generateText(_key, model, { prompt, system, images = [], files = [], json = false, timeoutMs }) {
  const st = await status();
  if (!st.installed) throw new AIError(INSTALL_HELP, 503);
  if (st.loggedIn === false) throw new AIError(LOGIN_HELP, 401);
  const exe = st.path;
  const full = prompt + (json ? '\n\nRespond with ONLY valid JSON, no prose, no code fences.' : '');
  const to = timeoutMs || (Number(process.env.CURSOR_AGENT_TIMEOUT_MIN || 0) * 60000) || 10 * 60000;
  const out = await withSlot(async () => {
    try { return await invoke(exe, { model, system, prompt: full, images, files, timeoutMs: to }); } catch (e) {
      if (e.modelError && model && model !== 'auto') return invoke(exe, { model: 'auto', system, prompt: full, images, files, timeoutMs: to });
      throw e;
    }
  });
  if (json) return require('./gemini').extractJson(out);
  return out;
}

module.exports = { AIError, status, chooseModels, generateText, cliPath, listModels, pickClaude, parseOutput };
