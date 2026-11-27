// Nightly pipeline: pick combos off the Pintu shelf, build them with the existing
// Create H5 path, play them in headless Chrome, score them with Pintu's rubric,
// and publish only the ones that clear the bar into gallery/.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const { ROOT, readRatings } = require('./data');
const studio = require('./studio');
const browser = require('./browser');
const AI = require('./ai');
const { framesToGif } = require('./gif');
const taste = require('./taste');
const { judgeGame } = require('./autopilot-rate');

const GALLERY = path.join(ROOT, 'gallery');
const GALLERY_GAMES = path.join(GALLERY, 'games');
const AUTO = path.join(ROOT, 'data', 'autopilot');
const HISTORY = path.join(AUTO, 'history.json');
const RUNS = path.join(AUTO, 'runs');

const tails = new Map();
// Themes picked this process but not yet written to history. Two combos of the
// same base game are chosen in parallel, and history is only updated after the build.
const inflightThemes = new Map();
function withLock(key, fn) {
  const prev = tails.get(key) || Promise.resolve();
  const run = prev.then(() => fn(), () => fn());
  tails.set(key, run.then(() => {}, () => {}));
  return run;
}

function loadJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}
function atomicWrite(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, typeof data === 'string' ? data : JSON.stringify(data, null, 2));
  fs.renameSync(tmp, file);
}
function loadHistory() {
  const h = loadJson(HISTORY, null);
  if (h && h.combos && typeof h.combos === 'object') return h;
  return { version: 1, combos: {} };
}
function saveHistory(h) {
  h.updated_at = new Date().toISOString();
  atomicWrite(HISTORY, h);
}

function nightOf(d = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}
function runStamp(d = new Date()) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(d);
  const get = (t) => parts.find((p) => p.type === t).value;
  return `${get('year')}-${get('month')}-${get('day')}T${get('hour')}${get('minute')}`;
}

function comboHash(gameId, theme, mechKey) {
  return crypto.createHash('sha1').update(`${gameId}\n${taste.norm(theme)}\n${mechKey}`).digest('hex').slice(0, 16);
}
function usedThemes(history, gameId, mechKey) {
  const exact = new Set();
  const any = new Set();
  for (const c of Object.values(history.combos || {})) {
    if (c.gameId !== gameId || !c.theme) continue;
    const name = taste.norm(c.theme);
    any.add(name);
    if (c.mechKey === mechKey) exact.add(name);
  }
  const inflight = inflightThemes.get(gameId);
  if (inflight) for (const name of inflight) any.add(name);
  return { exact, any };
}
function recordCombo(history, entry) {
  const id = comboHash(entry.gameId, entry.theme, entry.mechKey);
  history.combos[id] = { ...entry, id, at: new Date().toISOString() };
  saveHistory(history);
  return id;
}

function jobApi(tag) {
  return { step() {}, log(msg) { console.log(`  [${tag}] ${msg}`); } };
}
function withTimeout(ms, label, fn) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      const err = new Error(`${label} timed out after ${Math.round(ms / 60000)} min`);
      err.infra = true;
      reject(err);
    }, ms);
  });
  return Promise.race([Promise.resolve().then(fn), timeout]).finally(() => clearTimeout(timer));
}
function isInfra(e) {
  if (!e) return false;
  if (e.infra || e.status === 401 || e.status === 429 || (e.status >= 500 && e.status < 600)) return true;
  const m = String(e.message || e);
  return /timed out|No Chrome|ECONNREFUSED|not signed in|usage limit|CURSOR_API_KEY|ENOSPC|socket hang up|Target closed|Protocol error|Navigation timeout|net::|Model not available/i.test(m);
}

function startServer() {
  const app = express();
  app.use('/ideas', express.static(studio.IDEAS));
  app.use('/games', express.static(studio.GAMES));
  return new Promise((resolve) => {
    const server = app.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({ server, baseUrl: `http://127.0.0.1:${port}` });
    });
  });
}

async function themesFor(ai, game, mechanics) {
  const want = mechanics.map((m) => m.id).sort().join(',');
  let data = await studio.getThemes(ai, game, { mechanics });
  if ((data.mechKey || '') !== want) data = await studio.getThemes(ai, game, { mechanics, refresh: true });
  return data;
}
function pickTheme(themes, used) {
  const fresh = (themes || []).filter((t) => t && t.name && !used.exact.has(taste.norm(t.name)));
  // Prefer a skin this base game has not worn yet. Pintu's theme_ideas are often
  // a sentence or a single leftover word; a 2–3 word name reads like a real theme.
  const novel = fresh.filter((t) => !used.any.has(taste.norm(t.name)));
  const pool = novel.length ? novel : fresh;
  const rank = (t) => {
    const words = t.name.trim().split(/\s+/).length;
    const shape = words >= 2 && words <= 3 ? 0 : words <= 4 ? 1 : 2;
    return shape * 10 + (t.source === 'pintu' ? 0 : 1);
  };
  pool.sort((a, b) => rank(a) - rank(b));
  return pool[0] || null;
}
function claimTheme(gameId, themeName) {
  const name = taste.norm(themeName);
  let set = inflightThemes.get(gameId);
  if (!set) { set = new Set(); inflightThemes.set(gameId, set); }
  set.add(name);
}

function rebuildCatalogue({ threshold, lastRun }) {
  fs.mkdirSync(GALLERY_GAMES, { recursive: true });
  const games = fs.readdirSync(GALLERY_GAMES)
    .map((slug) => loadJson(path.join(GALLERY_GAMES, slug, 'meta.json'), null))
    .filter((m) => m && m.slug)
    .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
  const body = {
    updated_at: new Date().toISOString(),
    threshold,
    rubric: 'Pintu v2 (18 Nov 2026)',
    last_run: lastRun || null,
    count: games.length,
    games,
  };
  atomicWrite(path.join(GALLERY, 'games.json'), body);
  return body;
}

async function pickBestShot(shots) {
  const sharp = require('sharp');
  let best = shots[shots.length - 1];
  let bestV = -1;
  // The first frames are the title screen, which is busier than the board.
  // A still for the card should show play, so score the later half only.
  const later = shots.slice(Math.max(1, Math.ceil(shots.length / 2)));
  for (const s of (later.length ? later : shots)) {
    try {
      const st = await sharp(s).stats();
      const v = st.channels.slice(0, 3).reduce((a, c) => a + c.stdev, 0) / 3;
      if (v > bestV) { bestV = v; best = s; }
    } catch { /* skip a bad frame */ }
  }
  return best;
}

async function publish(meta, files) {
  const dest = path.join(GALLERY_GAMES, meta.slug);
  fs.mkdirSync(dest, { recursive: true });
  fs.copyFileSync(files.html, path.join(dest, 'index.html'));
  if (files.shot) fs.writeFileSync(path.join(dest, 'screenshot.png'), files.shot);
  if (files.gif) fs.writeFileSync(path.join(dest, 'preview.gif'), files.gif);
  atomicWrite(path.join(dest, 'meta.json'), meta);
  return dest;
}

function runtimeNote(validation, play) {
  const lines = [];
  if (validation) {
    lines.push(`Create H5 validation: ${validation.ok ? 'passed' : 'failed'}${validation.skipped ? ` (${validation.skipped})` : ''}.`);
    const errs = (validation.rounds || []).flatMap((r) => r.errors || []);
    if (errs.length) lines.push(`Build-time issues: ${errs.slice(0, 6).join(' | ')}`);
  }
  if (play) {
    lines.push(`Play session: ${play.ok ? 'ran' : 'problems'} — ${play.errors.slice(0, 6).join(' | ') || 'no console errors'}.`);
    if (play.info) lines.push(`Canvas count ${play.info.canvases}, DOM nodes ${play.info.elements}. Visible text: ${(play.info.bodyText || '').replace(/\s+/g, ' ').slice(0, 180)}`);
  }
  return lines.join('\n');
}

async function buildOne({ ai, baseUrl, cand, theme, timeoutMs }) {
  const tag = cand.game.name.slice(0, 18);
  const api = jobApi(tag);
  const idea = await studio.ideaJob(api, ai, {
    game: cand.game,
    theme,
    mechanics: cand.mechanics,
    previous: [],
    baseUrl,
  });
  const built = await studio.h5Job(api, ai, { idea, baseUrl });
  return { idea, built };
}

async function playBuilt(baseUrl, slug) {
  const url = `${baseUrl}/games/${slug}/index.html`;
  try {
    return await browser.capturePlay(url, { frames: 8 });
  } catch (e) {
    e.infra = e.infra || /No Chrome|Protocol error|Target closed|Navigation timeout/i.test(e.message || '');
    throw e;
  }
}

function galleryMeta({ built, idea, cand, theme, rated, night, shot, gif }) {
  const concept = idea.concept || {};
  const pillars = (rated.score.pillars || []).map((p) => ({
    key: p.key, label: p.label, score: p.score, weight: p.weight,
  }));
  return {
    slug: built.slug,
    title: concept.title || built.title,
    tagline: concept.tagline || '',
    pitch: String(concept.hook || concept.tagline || '').replace(/\s+/g, ' ').trim(),
    score: rated.score.overall,
    score_uncapped: rated.score.overall_uncapped,
    cap: rated.score.cap,
    confidence: rated.score.confidence,
    reads: rated.reads,
    pillars,
    formula: rated.score.formula,
    verdict: rated.verdict,
    summary: rated.summary,
    base_game: {
      id: cand.game.id,
      name: cand.game.name,
      score: cand.game.overall_score,
      category: cand.game.category,
    },
    theme: { name: theme.name, description: theme.description || '' },
    mechanics: cand.mechanics.map(({ id, name }) => ({ id, name })),
    night,
    created_at: new Date().toISOString(),
    provider: idea.provider || 'cursor-agent',
    mock: idea.provider === 'mock',
    play: `games/${built.slug}/index.html`,
    screenshot: shot ? `games/${built.slug}/screenshot.png` : null,
    gif: gif ? `games/${built.slug}/preview.gif` : null,
  };
}
function snapshotDir(dir) {
  if (!fs.existsSync(dir)) return new Set();
  return new Set(fs.readdirSync(dir));
}
function sweepNew(dir, before) {
  if (!fs.existsSync(dir)) return;
  for (const name of fs.readdirSync(dir)) {
    if (!before.has(name)) fs.rmSync(path.join(dir, name), { recursive: true, force: true });
  }
}

async function runAutopilot(opts) {
  const count = Math.max(1, Number(opts.count) || 20);
  const threshold = Number.isFinite(Number(opts.threshold)) ? Number(opts.threshold) : 7;
  const parallel = Math.max(1, Number(opts.parallel) || 2);
  const timeoutMs = Math.max(1, Number(opts.timeoutMin) || 30) * 60000;
  const seed = opts.seed || nightOf();
  const night = nightOf();
  const started = new Date();

  if (!browser.chromePath()) {
    throw Object.assign(new Error('No Chrome/Chromium found. Install Google Chrome or set CHROME_PATH. The autopilot cannot rate a game it cannot play.'), { status: 1 });
  }
  const ai = AI.client(AI.resolve({ headers: {} }));
  if (!ai.ctx.mock) {
    const why = await ai.notReady();
    if (why) throw Object.assign(new Error(why), { status: 1 });
  }

  const history = loadHistory();
  const { games } = readRatings();
  const plan = taste.planCombos({ games, history, count, seed, limit: Math.max(count * 3, count + 8) });
  console.log(`Golu autopilot  night ${night}  mode ${ai.ctx.mock ? 'MOCK' : ai.ctx.provider}  chrome ${browser.chromePath()}`);
  console.log(`Shelf ${games.length}  promising bases ${plan.bases}  candidates ${plan.candidates}  queue ${plan.combos.length}`);
  console.log(`Trying ${count}  keep >= ${threshold}  parallel ${parallel}  per-game timeout ${Math.round(timeoutMs / 60000)} min`);
  if (!plan.combos.length) {
    console.log('Nothing left to try. History already covers the promising combos, or the shelf filter excluded everything.');
  }

  const { server, baseUrl } = await startServer();
  const ideasBefore = snapshotDir(studio.IDEAS);
  const gamesBefore = snapshotDir(studio.GAMES);
  const queue = plan.combos.slice();
  let reserved = 0;
  const results = [];

  function reserve() {
    if (reserved >= count) return false;
    reserved += 1;
    return true;
  }

  async function worker(index) {
    while (reserved < count) {
      const cand = queue.shift();
      if (!cand) return;
      let theme = null;
      try {
        await withLock(cand.game.id, async () => {
          const data = await themesFor(ai, cand.game, cand.mechanics);
          theme = pickTheme(data.themes, usedThemes(history, cand.game.id, cand.mechKey));
          if (theme) claimTheme(cand.game.id, theme.name);
        });
      } catch (e) {
        if (!reserve()) return;
        const row = { outcome: isInfra(e) ? 'infra' : 'broken', label: taste.labelCombo(cand), error: e.message, ms: 0 };
        results.push(row);
        console.log(`✗ theme failed: ${row.label} — ${e.message}`);
        if (row.outcome === 'broken') {
          recordCombo(history, {
            gameId: cand.game.id, gameName: cand.game.name, theme: '', mechKey: cand.mechKey,
            mechanics: cand.mechIds, primary: cand.primary, outcome: 'broken', score: null, error: e.message,
          });
        }
        continue;
      }
      if (!theme) {
        console.log(`· skip ${cand.game.name} [${cand.mechKey}] — every theme for this pairing is already in history`);
        continue;
      }
      if (!reserve()) return;
      const label = taste.labelCombo(cand, theme.name);
      const t0 = Date.now();
      console.log(`\n▶ ${label}`);
      let idea = null;
      let built = null;
      try {
        const outcome = await withTimeout(timeoutMs, label, async () => {
          const made = await buildOne({ ai, baseUrl, cand, theme, timeoutMs });
          idea = made.idea;
          built = made.built;
          const validation = built.validation || { ok: false, rounds: [] };
          if (!validation.ok) {
            const errs = (validation.rounds || []).flatMap((r) => r.errors || []);
            return {
              outcome: 'broken',
              error: validation.skipped || errs[0] || 'validation failed',
              errors: errs.slice(0, 8),
            };
          }
          let play = null;
          try { play = await playBuilt(baseUrl, built.slug); } catch (e) {
            if (!validation.ok) throw e;
            console.log(`  [play] screenshot pass failed (${e.message}); using the build validation shots`);
          }
          if (play && play.variance != null && play.variance < 3) {
            return { outcome: 'broken', error: 'blank screen after play', errors: play.errors };
          }
          const shots = (play && play.shots && play.shots.length) ? play.shots : [];
          const rated = await judgeGame(ai, {
            combo: { ...cand, theme },
            concept: idea.concept,
            runtime: runtimeNote(validation, play),
            shots,
          });
          const keep = rated.score.overall >= threshold;
          let shot = null;
          let gif = null;
          if (keep) {
            shot = shots.length ? await pickBestShot(shots) : (fs.existsSync(path.join(studio.GAMES, built.slug, 'screenshot.png')) ? fs.readFileSync(path.join(studio.GAMES, built.slug, 'screenshot.png')) : null);
            if (shots.length >= 2) {
              try { gif = await framesToGif(shots.slice(0, 8), { width: 280, delay: 260 }); } catch (e) { console.log(`  [gif] ${e.message}`); }
            }
            const meta = galleryMeta({ built, idea, cand, theme, rated, night, shot, gif });
            meta.provider = idea.provider;
            await publish(meta, {
              html: path.join(studio.GAMES, built.slug, 'index.html'),
              shot, gif,
            });
            rebuildCatalogue({ threshold, lastRun: null });
          }
          return {
            outcome: keep ? 'kept' : 'below',
            score: rated.score.overall,
            verdict: rated.verdict,
            slug: keep ? built.slug : null,
            reads: rated.reads,
            title: idea.concept?.title,
          };
        });
        const row = {
          outcome: outcome.outcome,
          label,
          game: cand.game.name,
          gameId: cand.game.id,
          theme: theme.name,
          mechanics: cand.mechanics.map((m) => m.name),
          mechKey: cand.mechKey,
          primary: cand.primary,
          title: outcome.title || null,
          score: outcome.score ?? null,
          verdict: outcome.verdict || outcome.error || '',
          slug: outcome.slug || null,
          reads: outcome.reads || null,
          error: outcome.error || null,
          ms: Date.now() - t0,
        };
        results.push(row);
        recordCombo(history, {
          gameId: cand.game.id,
          gameName: cand.game.name,
          theme: theme.name,
          mechKey: cand.mechKey,
          mechanics: cand.mechIds,
          primary: cand.primary,
          outcome: row.outcome === 'below' ? 'discarded' : row.outcome,
          score: row.score,
          slug: row.slug,
          verdict: row.verdict,
          title: row.title,
        });
        const mark = row.outcome === 'kept' ? '✓ kept' : row.outcome === 'below' ? '· below bar' : '✗ broken';
        console.log(`${mark}  ${row.score == null ? '' : `${row.score}/10  `}${row.verdict || row.error || ''}  (${Math.round(row.ms / 1000)}s)`);
      } catch (e) {
        const infra = isInfra(e);
        const row = {
          outcome: infra ? 'infra' : 'broken',
          label, game: cand.game.name, gameId: cand.game.id, theme: theme.name,
          mechanics: cand.mechanics.map((m) => m.name), mechKey: cand.mechKey, primary: cand.primary,
          score: null, verdict: '', error: e.message, slug: null, ms: Date.now() - t0,
        };
        results.push(row);
        if (!infra) {
          recordCombo(history, {
            gameId: cand.game.id, gameName: cand.game.name, theme: theme.name, mechKey: cand.mechKey,
            mechanics: cand.mechIds, primary: cand.primary, outcome: 'broken', score: null, error: e.message,
          });
        }
        console.log(`${infra ? '! infra (will retry another night)' : '✗ broken'}  ${e.message}`);
      } finally {
        if (idea && idea.id) fs.rmSync(path.join(studio.IDEAS, idea.id), { recursive: true, force: true });
        if (built && built.slug) fs.rmSync(path.join(studio.GAMES, built.slug), { recursive: true, force: true });
      }
    }
    if (index) { /* workers are identical; index avoids an unused-arg lint in some editors */ }
  }

  try {
    await Promise.all(Array.from({ length: Math.min(parallel, Math.max(plan.combos.length, 1)) }, (_, i) => worker(i)));
  } finally {
    sweepNew(studio.IDEAS, ideasBefore);
    sweepNew(studio.GAMES, gamesBefore);
    // Close Chrome before the static server. A page that still holds a keep-alive
    // connection will otherwise stall server.close() until the job is killed.
    await Promise.race([
      browser.closeBrowser(),
      new Promise((r) => setTimeout(r, 8000)),
    ]);
    if (typeof server.closeAllConnections === 'function') server.closeAllConnections();
    await new Promise((r) => server.close(r));
  }

  const tally = (k) => results.filter((x) => x.outcome === k).length;
  const report = {
    started_at: started.toISOString(),
    finished_at: new Date().toISOString(),
    night,
    mock: !!ai.ctx.mock,
    provider: ai.ctx.mock ? 'mock' : ai.ctx.provider,
    count,
    threshold,
    parallel,
    timeout_min: Math.round(timeoutMs / 60000),
    tried: results.length,
    kept: tally('kept'),
    discarded: tally('below'),
    broken: tally('broken'),
    infra: tally('infra'),
    games: results,
  };
  fs.mkdirSync(RUNS, { recursive: true });
  const runFile = path.join(RUNS, `${runStamp(started)}.json`);
  atomicWrite(runFile, report);
  atomicWrite(path.join(AUTO, 'latest.json'), report);
  const lastRun = {
    night, tried: report.tried, kept: report.kept, discarded: report.discarded,
    broken: report.broken, infra: report.infra, threshold, finished_at: report.finished_at, mock: report.mock,
  };
  rebuildCatalogue({ threshold, lastRun });

  console.log(`\nNight ${night}: tried ${report.tried}, kept ${report.kept}, below ${report.discarded}, broken ${report.broken}, infra ${report.infra}`);
  console.log(`Report ${path.relative(ROOT, runFile)}`);
  writeStepSummary(report);

  const judged = report.kept + report.discarded + report.broken;
  if (!judged && report.infra > 0) {
    const err = new Error(`Every attempt failed before it could be judged (${report.infra} infra). See ${path.relative(ROOT, runFile)}.`);
    err.report = report;
    err.status = 1;
    throw err;
  }
  return report;
}

function writeStepSummary(report) {
  const file = process.env.GITHUB_STEP_SUMMARY;
  if (!file) return;
  const lines = [
    `## Autopilot ${report.night}`,
    '',
    `Tried **${report.tried}**, kept **${report.kept}**, below ${report.threshold} **${report.discarded}**, broken **${report.broken}**, infra **${report.infra}**.`,
    '',
    '| Result | Score | Game |',
    '| --- | --- | --- |',
  ];
  for (const g of report.games) {
    const score = g.score == null ? '—' : g.score.toFixed(1);
    lines.push(`| ${g.outcome} | ${score} | ${String(g.title || g.label || '').replace(/\|/g, '/')} |`);
  }
  fs.appendFileSync(file, `${lines.join('\n')}\n`);
}

function printPlan(opts) {
  const count = Math.max(1, Number(opts.count) || 20);
  const seed = opts.seed || nightOf();
  const history = loadHistory();
  const { games } = readRatings();
  const plan = taste.planCombos({ games, history, count, seed });
  console.log(`Promising bases: ${plan.bases}   candidates: ${plan.candidates}   showing ${Math.min(count, plan.combos.length)} of ${plan.combos.length} queued (seed ${seed})`);
  plan.combos.slice(0, count).forEach((c, i) => {
    console.log(`${String(i + 1).padStart(2, ' ')}. ${c.game.overall_score.toFixed(1)}  ${c.game.name}  [${c.primary}]  + ${c.mechanics.filter((m) => m.id !== 'original').map((m) => m.name).join(' + ')}${c.pureMatch3 ? '  (match-3 twist)' : ''}`);
  });
  return plan;
}

module.exports = { runAutopilot, printPlan, rebuildCatalogue, nightOf, GALLERY, HISTORY };
