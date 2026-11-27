// Golu Studio server: static frontend + JSON API. Run: npm install && npm start
const path = require('path');
const fs = require('fs');
require('./lib/env').loadEnv(__dirname);
const express = require('express');
const archiver = require('archiver');
const { readRatings, getGame } = require('./lib/data');
const ratingsSync = require('./lib/sync-ratings');
const { mechanicsFor } = require('./lib/mechanics');
const AI = require('./lib/ai');
const studio = require('./lib/studio');
const { createJob, getJob } = require('./lib/jobs');
const browser = require('./lib/browser');

const PORT = Number(process.env.PORT || 5173);
const HOST = process.env.HOST || '127.0.0.1';
const BASE = `http://127.0.0.1:${PORT}`;
const app = express();
app.use(express.json({ limit: '5mb' }));

// Optional HTTP basic auth when APP_PASSWORD is set (public hosts). Off when unset.
// Render health checks hit /health with no credentials, so that path stays open.
app.get('/health', (_req, res) => res.status(200).type('text/plain').send('ok'));
app.use((req, res, next) => {
  const pass = process.env.APP_PASSWORD;
  if (!pass) return next();
  const user = process.env.APP_USER || 'golu';
  const hdr = req.headers.authorization || '';
  const decoded = hdr.startsWith('Basic ') ? Buffer.from(hdr.slice(6), 'base64').toString('utf8') : '';
  const i = decoded.indexOf(':');
  const u = i === -1 ? decoded : decoded.slice(0, i);
  const p = i === -1 ? '' : decoded.slice(i + 1);
  const crypto = require('crypto');
  const same = (a, b) => {
    const ba = Buffer.from(String(a));
    const bb = Buffer.from(String(b));
    if (ba.length !== bb.length) return false;
    return crypto.timingSafeEqual(ba, bb);
  };
  if (same(u, user) && same(p, pass)) return next();
  res.set('WWW-Authenticate', 'Basic realm="Golu Studio"');
  return res.status(401).type('text/plain').send('Authentication required');
});

const wrap = (fn) => (req, res) => Promise.resolve(fn(req, res)).catch((e) => {
  console.error(`[api] ${req.method} ${req.path}: ${e.message}`);
  res.status(e.status && e.status < 600 ? e.status : 500).json({ error: e.message });
});
const ctx = (req) => AI.client(AI.resolve(req));
const needGame = (id) => { const g = getGame(id); if (!g) throw Object.assign(new Error(`Game not found: ${id}`), { status: 404 }); return g; };

app.get('/api/games', wrap(async (req, res) => res.json(readRatings())));
app.get('/api/sync-status', wrap(async (_req, res) => res.json(ratingsSync.getStatus())));
app.get('/api/games/:id', wrap(async (req, res) => res.json(needGame(req.params.id))));

app.get('/api/config', wrap(async (req, res) => {
  const c = AI.resolve(req);
  const m = await AI.models(c);
  const fresh = { fresh: req.query.fresh === '1' };
  const cc = c.provider === 'claude-code' && !c.mock ? await require('./lib/claude-code').status(fresh) : null;
  const ca = c.provider === 'cursor-agent' && !c.mock ? await require('./lib/cursor-agent').status(fresh) : null;
  res.json({ provider: c.provider, providerLabel: AI.LABEL[c.provider], mock: c.mock, ready: !(await AI.notReady(c)), claudeCode: cc, cursorAgent: ca, keyPresent: AI.isCli(c.provider) ? true : !!c.key, keySource: req.headers['x-anthropic-key'] || req.headers['x-gemini-key'] ? 'browser' : c.key ? 'server env/.env' : null, models: m, chrome: browser.chromePath() ? 'found' : 'missing', envProviders: { anthropic: !!process.env.ANTHROPIC_API_KEY, gemini: !!process.env.GEMINI_API_KEY } });
}));

app.get('/api/games/:id/themes', wrap(async (req, res) => {
  const game = needGame(req.params.id);
  // ?mechs=sorting,merge -> resolve against the game's mechanic library (names/descs come from the server, not the client)
  const ids = String(req.query.mechs || '').split(',').map((x) => x.trim()).filter((x) => x && x !== 'original');
  let mechanics = [];
  if (ids.length) { const { games } = readRatings(); const lib = mechanicsFor(game, games); mechanics = ids.map((mid) => lib.find((m) => m.id === mid)).filter(Boolean); }
  res.json(await studio.getThemes(ctx(req), game, { more: req.query.more === '1', refresh: req.query.refresh === '1', mechanics }));
}));
app.get('/api/games/:id/themes/:tid/preview', wrap(async (req, res) => {
  const file = await studio.themePreview(ctx(req), needGame(req.params.id), req.params.tid);
  res.type('image/svg+xml').set('cache-control', 'public, max-age=86400').send(fs.readFileSync(file));
}));
app.get('/api/games/:id/mechanics', wrap(async (req, res) => { const { games } = readRatings(); res.json(mechanicsFor(needGame(req.params.id), games)); }));
app.post('/api/merge', wrap(async (req, res) => res.json(await studio.mergeSummary(ctx(req), needGame(req.body.gameId), req.body.theme, req.body.mechanics || []))));

app.get('/api/ideas', wrap(async (req, res) => res.json(studio.listIdeas(req.query.gameId))));
app.get('/api/ideas/:id', wrap(async (req, res) => { const i = studio.getIdea(req.params.id); if (!i) return res.status(404).json({ error: 'not found' }); res.json({ ...i, builds: studio.listBuilds(i.id) }); }));
app.post('/api/ideas', wrap(async (req, res) => {
  const ai = ctx(req); const game = needGame(req.body.gameId);
  if (!req.body.theme || !(req.body.mechanics || []).length) throw Object.assign(new Error('Pick a theme and at least one mechanic'), { status: 400 });
  { const why = await ai.notReady(); if (why) throw Object.assign(new Error(why), { status: 401 }); }
  const job = createJob('idea', ['Design concept', 'Draw animated mockup', 'Capture frames (headless Chrome)', 'Encode GIF'], (api) => studio.ideaJob(api, ai, { game, theme: req.body.theme, mechanics: req.body.mechanics, previous: req.body.previous || [], baseUrl: BASE }));
  res.json({ jobId: job.id });
}));
app.post('/api/h5', wrap(async (req, res) => {
  const ai = ctx(req); const idea = studio.getIdea(req.body.ideaId);
  if (!idea) throw Object.assign(new Error('Idea not found'), { status: 404 });
  { const why = await ai.notReady(); if (why) throw Object.assign(new Error(why), { status: 401 }); }
  const job = createJob('h5', ['Draw SVG art assets', 'Write game code', 'Validate in headless Chrome (auto-fix)', 'Package'], (api) => studio.h5Job(api, ai, { idea, baseUrl: BASE }));
  res.json({ jobId: job.id });
}));
// ---------- Rate My Game ----------
const rate = require('./lib/rate');
const multer = require('multer');
const RATE_MAX_MB = Number(process.env.RATE_MAX_MB || 2048);
const incoming = path.join(rate.RATED_DIR, '.incoming'); fs.mkdirSync(incoming, { recursive: true });
const upload = multer({ dest: incoming, limits: { fileSize: RATE_MAX_MB * 1024 * 1024, files: 30, fieldSize: 2 * 1024 * 1024 } });
const cleanupIncoming = (files) => (files || []).forEach((f) => fs.rm(f.path, { force: true }, () => {}));
app.get('/api/rated', wrap(async (_req, res) => res.json(rate.listRated())));
app.get('/api/rated/:id', wrap(async (req, res) => { const r = rate.getReport(req.params.id); if (!r) return res.status(404).json({ error: 'Rating not found' }); res.json(r); }));
app.delete('/api/rated/:id', wrap(async (req, res) => res.json(rate.deleteRated(req.params.id))));
app.post('/api/rate', (req, res, next) => upload.array('files', 30)(req, res, (err) => {
  if (err) { cleanupIncoming(req.files); return res.status(err.code === 'LIMIT_FILE_SIZE' ? 413 : 400).json({ error: err.code === 'LIMIT_FILE_SIZE' ? `File too large (limit ${RATE_MAX_MB} MB per file; raise RATE_MAX_MB in .env)` : err.message }); }
  next();
}), wrap(async (req, res) => {
  const files = req.files || [];
  if (!files.length) throw Object.assign(new Error('Add at least one file to rate'), { status: 400 });
  const ai = ctx(req);
  { const why = await ai.notReady(); if (why) { cleanupIncoming(files); throw Object.assign(new Error(why), { status: 401 }); } }
  const id = rate.newId();
  rate.saveUploads(id, files);
  const meta = { name: String(req.body.name || '').slice(0, 120), genre: String(req.body.genre || '').slice(0, 120), notes: String(req.body.notes || '').slice(0, 4000) };
  require('fs').writeFileSync(path.join(rate.dirOf(id), 'meta.json'), JSON.stringify(meta));
  const job = createJob('rate', ['Upload files', 'Extract frames, screenshots & text', "Judge with Pintu's v2 rubric (AI)", 'Compute score & save to catalogue'], (api) => rate.rateJob(api, ai, { id, meta }));
  res.json({ jobId: job.id, id });
}));
app.post('/api/rated/:id/retry', wrap(async (req, res) => {
  const dir = rate.dirOf(req.params.id);
  if (!fs.existsSync(path.join(dir, 'uploads.json'))) throw Object.assign(new Error('Uploads for this rating are gone; upload again'), { status: 404 });
  const ai = ctx(req); { const why = await ai.notReady(); if (why) throw Object.assign(new Error(why), { status: 401 }); }
  let meta = {}; try { meta = JSON.parse(fs.readFileSync(path.join(dir, 'meta.json'), 'utf8')); } catch {}
  const job = createJob('rate', ['Upload files', 'Extract frames, screenshots & text', "Judge with Pintu's v2 rubric (AI)", 'Compute score & save to catalogue'], (api) => rate.rateJob(api, ai, { id: req.params.id, meta }));
  res.json({ jobId: job.id, id: req.params.id });
}));
// Serve thumbnails and extracted visuals only (never the raw uploads or unzipped builds).
app.use('/rated', (req, res, next) => (/^\/[0-9]{8}-[a-f0-9]{6}\/(thumb\.jpg|assets\/[\w.-]+)$/.test(req.path) ? next() : res.status(404).end()), express.static(rate.RATED_DIR, { maxAge: '1d' }));

app.get('/api/claude-code/status', wrap(async (req, res) => res.json(await require('./lib/claude-code').status({ fresh: true }))));
app.post('/api/claude-code/test', wrap(async (req, res) => {
  const cc = require('./lib/claude-code');
  const t0 = Date.now();
  const ai = AI.client({ ...AI.resolve(req), provider: 'claude-code', mock: false, key: 'subscription' });
  const out = await ai.text({ prompt: 'Reply with exactly the word OK and nothing else.', timeoutMs: 120000 });
  res.json({ ok: /ok/i.test(out), reply: out.trim().slice(0, 80), ms: Date.now() - t0, status: await cc.status() });
}));
app.get('/api/cursor-agent/status', wrap(async (req, res) => res.json(await require('./lib/cursor-agent').status({ fresh: true }))));
app.post('/api/cursor-agent/test', wrap(async (req, res) => {
  const ca = require('./lib/cursor-agent');
  const t0 = Date.now();
  const ai = AI.client({ ...AI.resolve(req), provider: 'cursor-agent', mock: false, key: 'subscription' });
  const m = await ai.models();
  const out = await ai.text({ prompt: 'Reply with exactly the word OK and nothing else.', timeoutMs: 180000 });
  res.json({ ok: /ok/i.test(out), reply: out.trim().slice(0, 80), ms: Date.now() - t0, models: { text: m.text, code: m.code, discovered: m.discovered }, status: await ca.status() });
}));
app.get('/api/builds', wrap(async (req, res) => res.json(studio.listBuilds(req.query.ideaId))));
app.get('/api/jobs/:id', wrap(async (req, res) => { const j = getJob(req.params.id); if (!j) return res.status(404).json({ error: 'job not found (server restarted?)' }); res.json(j); }));
app.get('/api/h5/:slug/zip', wrap(async (req, res) => {
  const slug = req.params.slug.replace(/[^a-z0-9-]/gi, '');
  const dir = path.join(studio.GAMES, slug);
  if (!fs.existsSync(path.join(dir, 'index.html'))) return res.status(404).json({ error: 'not found' });
  res.attachment(`${slug}.zip`);
  const z = archiver('zip', { zlib: { level: 9 } }); z.pipe(res); z.directory(dir, slug); await z.finalize();
}));

app.use('/icons', express.static(path.join(__dirname, 'data', 'icons'), { maxAge: '7d' }));
app.use('/ideas', express.static(studio.IDEAS));
app.use('/games', express.static(studio.GAMES));
app.use(express.static(path.join(__dirname, 'public')));

const server = app.listen(PORT, HOST, () => {
  const c = AI.resolve({ headers: {} });
  const shown = HOST === '127.0.0.1' || HOST === 'localhost' ? `http://localhost:${PORT}` : `http://${HOST}:${PORT} (also http://localhost:${PORT})`;
  console.log(`\n  Golu Studio running at ${shown}\n  AI provider: ${c.mock ? 'MOCK (offline demo)' : AI.LABEL[c.provider]}\n  Headless browser: ${browser.chromePath() || 'not found (set CHROME_PATH) - GIF capture and H5 validation disabled'}\n  Password: ${process.env.APP_PASSWORD ? 'on (APP_PASSWORD)' : 'off'}\n`);
  if (!c.mock && c.provider === 'cursor-agent') require('./lib/cursor-agent').status().then((s) => console.log(`  Cursor CLI: ${s.installed ? `${s.version || 'installed'} at ${s.path}; signed in: ${s.loggedIn === null ? 'unknown' : s.loggedIn ? `yes${s.account ? ` (${s.account})` : ''}` : 'NO - run \`cursor-agent login\`'}` : 'NOT FOUND - curl https://cursor.com/install -fsS | bash'}\n`));
  if (!c.mock && c.provider === 'claude-code') require('./lib/claude-code').status().then((s) => console.log(`  Claude Code CLI: ${s.installed ? `${s.version || 'installed'} at ${s.path}; signed in: ${s.loggedIn === null ? 'unknown' : s.loggedIn ? `yes (${s.authMethod || 'ok'})` : 'NO - run \`claude\` and sign in'}` : 'NOT FOUND - npm install -g @anthropic-ai/claude-code'}\n`));
  require('./scripts/fetch-icons').fetchIcons({ quiet: true }).catch(() => {});
  ratingsSync.startPolling();
  if (process.env.NO_OPEN !== '1' && process.env.OPEN_BROWSER !== '0') {
    const { exec } = require('child_process');
    const url = `http://localhost:${PORT}`;
    const cmd = process.platform === 'win32' ? `start "" "${url}"` : process.platform === 'darwin' ? `open "${url}"` : `xdg-open "${url}"`;
    exec(cmd, () => {});
  }
});
server.on('error', (e) => {
  if (e.code === 'EADDRINUSE') console.error(`\n  Port ${PORT} is already in use. Is Golu Studio already running? Try: PORT=5174 npm start\n`);
  else console.error(e);
  process.exit(1);
});
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, async () => { await browser.closeBrowser(); process.exit(0); });
