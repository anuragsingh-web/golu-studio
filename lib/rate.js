// "Rate My Game": upload anything (video, images, HTML/zip builds, APK, PDF, docs...), extract what the AI can use,
// have the AI judge it with Pintu's v2 rubric, then compute the score in code (lib/scoring-v2.js) and keep a catalogue.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFile } = require('child_process');
const { pathToFileURL } = require('url');
const { ROOT, readRatings } = require('./data');
const browser = require('./browser');
const S = require('./scoring-v2');

const RATED_DIR = path.join(ROOT, 'data', 'rated-games');
const CAT_FILE = path.join(ROOT, 'data', 'rated_games.json');
const RUBRIC_DIR = path.join(ROOT, 'data', 'rubric');
fs.mkdirSync(RATED_DIR, { recursive: true });

const newId = () => `${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${crypto.randomBytes(3).toString('hex')}`;
const validId = (id) => /^[0-9]{8}-[a-f0-9]{6}$/.test(String(id || ''));
const dirOf = (id) => { if (!validId(id)) throw Object.assign(new Error('Bad rating id'), { status: 400 }); return path.join(RATED_DIR, id); };
const safeName = (n) => String(n || 'file').normalize('NFKD').replace(/[^\w.\- ]+/g, '_').replace(/\s+/g, '_').replace(/^\.+/, '').slice(-120) || 'file';

// ---------- catalogue ----------
function readCatalogue() { try { const d = JSON.parse(fs.readFileSync(CAT_FILE, 'utf8')); return Array.isArray(d.games) ? d : { games: [] }; } catch { return { games: [] }; } }
function writeCatalogue(d) { d.count = d.games.length; d.updated_at = new Date().toISOString(); const t = `${CAT_FILE}.tmp`; fs.writeFileSync(t, JSON.stringify(d, null, 1)); fs.renameSync(t, CAT_FILE); }
function listRated() { const d = readCatalogue(); return { count: d.games.length, rubric_version: S.RUBRIC_VERSION, games: d.games }; }
function getReport(id) { try { return JSON.parse(fs.readFileSync(path.join(dirOf(id), 'report.json'), 'utf8')); } catch { return null; } }
function deleteRated(id) {
  const dir = dirOf(id); const d = readCatalogue(); const before = d.games.length;
  d.games = d.games.filter((g) => g.id !== id); writeCatalogue(d);
  fs.rmSync(dir, { recursive: true, force: true });
  return { deleted: before !== d.games.length, count: d.games.length };
}

// ---------- Pintu's v2 catalogue (comparables) ----------
function v2Catalogue() {
  const tryRead = (p) => { try { const d = JSON.parse(fs.readFileSync(p, 'utf8')); return d.games?.length ? d : null; } catch { return null; } };
  // 1) the synced ratings file if it already carries v2 pillar scores, 2) Pintu's shared file (Golu's box), 3) bundled snapshot.
  const synced = readRatings(); const syncedV2 = synced.games.filter((g) => g.scores && g.scores.momentum != null);
  if (syncedV2.length > 20) return { source: 'synced ratings', updated_at: synced.meta.updated_at, games: syncedV2.map((g) => ({ ...g, overall: g.overall_score })) };
  for (const p of [process.env.PINTU_SHARED_FILE, '/workspace/shared/pintu_ratings.json'].filter(Boolean)) {
    const d = tryRead(p); const gs = d?.games.filter((g) => g.scores && g.scores.momentum != null);
    if (gs?.length) return { source: p, updated_at: d.updated_at, games: gs.map((g) => ({ ...g, overall: g.overall_score })) };
  }
  const d = tryRead(path.join(RUBRIC_DIR, 'pintu_v2_scores.json'));
  return { source: 'bundled snapshot data/rubric/pintu_v2_scores.json', updated_at: d?.updated_at, games: d?.games || [] };
}
const toks = (s) => new Set(String(s || '').toLowerCase().match(/[a-z]{3,}/g) || []);
const STOP = new Set(['the', 'and', 'game', 'games', 'puzzle', 'with', 'for', 'tap', 'mobile', 'casual', 'hybrid', 'your', 'you', 'this', 'that', 'from', 'are', 'not', 'play']);
function keywordComparables(text, games, n = 5) {
  const t = [...toks(text)].filter((w) => !STOP.has(w));
  return games.map((g) => { const gt = toks(`${g.name} ${(g.genres || []).join(' ')} ${g.reason} ${g.input_type} ${(g.mashup_mechanics || []).join(' ')}`); return { g, s: t.filter((w) => gt.has(w)).length + (g.overall || 0) / 100 }; })
    .sort((a, b) => b.s - a.s).slice(0, n).map((x) => ({ game: x.g, similarity: 1, why: 'keyword match (fallback)' }));
}

// ---------- extraction helpers ----------
const run = (cmd, args, { timeout = 120000, maxBuffer = 64 * 1024 * 1024 } = {}) => new Promise((res) => {
  execFile(cmd, args, { timeout, maxBuffer, windowsHide: true }, (err, stdout, stderr) => res({ ok: !err, stdout: String(stdout || ''), stderr: String(stderr || ''), err }));
});
const which = {};
async function has(cmd) {
  if (cmd in which) return which[cmd];
  const r = await run(cmd, ['-version'], { timeout: 8000 }); const r2 = r.ok ? r : await run(cmd, ['-v'], { timeout: 8000 });
  return (which[cmd] = r.ok || r2.ok || /version/i.test(r.stderr + r2.stderr));
}
const ffmpegBin = () => process.env.FFMPEG_PATH || 'ffmpeg';
const ffprobeBin = () => process.env.FFPROBE_PATH || 'ffprobe';
const EXT = {
  image: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'avif', 'bmp', 'tif', 'tiff', 'svg', 'heic', 'heif'],
  video: ['mp4', 'mov', 'webm', 'mkv', 'avi', 'm4v', '3gp', 'wmv', 'flv', 'mpg', 'mpeg', 'ogv'],
  html: ['html', 'htm'],
  zip: ['zip'],
  app: ['apk', 'aab', 'xapk', 'apks', 'ipa'],
  pdf: ['pdf'],
  office: ['docx', 'pptx', 'xlsx', 'odt', 'odp', 'ods', 'key', 'pages'],
  text: ['txt', 'md', 'markdown', 'json', 'csv', 'tsv', 'js', 'mjs', 'ts', 'css', 'cs', 'lua', 'py', 'gd', 'yaml', 'yml', 'xml', 'rtf', 'ini', 'cfg', 'log', 'java', 'kt', 'swift', 'c', 'cpp', 'h'],
};
function kindOf(name, mime = '') {
  const e = path.extname(name).slice(1).toLowerCase();
  for (const [k, v] of Object.entries(EXT)) if (v.includes(e)) return k;
  if (/^image\//.test(mime)) return 'image'; if (/^video\//.test(mime)) return 'video'; if (/html/.test(mime)) return 'html'; if (/pdf/.test(mime)) return 'pdf'; if (/zip/.test(mime)) return 'zip';
  if (/^text\/|json|javascript|xml/.test(mime)) return 'text';
  return 'other';
}
function looksText(file) { try { const fd = fs.openSync(file, 'r'); const b = Buffer.alloc(4096); const n = fs.readSync(fd, b, 0, 4096, 0); fs.closeSync(fd); return n > 0 && !b.subarray(0, n).includes(0); } catch { return false; } }
const readHead = (file, max) => { const fd = fs.openSync(file, 'r'); const b = Buffer.alloc(Math.min(max, fs.statSync(file).size)); fs.readSync(fd, b, 0, b.length, 0); fs.closeSync(fd); return b.toString('utf8'); };
const fmtSize = (n) => (n > 1e6 ? `${(n / 1e6).toFixed(1)} MB` : `${Math.ceil(n / 1e3)} KB`);

async function toPng(src, dest, max = 1280) {
  const sharp = require('sharp');
  await sharp(src, { animated: false, limitInputPixels: false }).rotate().resize({ width: max, height: max, fit: 'inside', withoutEnlargement: true }).png().toFile(dest);
  return dest;
}

function zipEntries(file) {
  const yauzl = require('yauzl');
  return new Promise((res, rej) => yauzl.open(file, { lazyEntries: true, autoClose: false }, (err, zip) => {
    if (err) return rej(err);
    const list = []; zip.on('entry', (e) => { list.push({ name: e.fileName, size: e.uncompressedSize, e }); zip.readEntry(); });
    zip.on('end', () => res({ zip, list })); zip.on('error', rej); zip.readEntry();
  }));
}
function readEntry(zip, e, max = 8 * 1024 * 1024) {
  return new Promise((res, rej) => zip.openReadStream(e, (err, s) => {
    if (err) return rej(err); const chunks = []; let n = 0;
    s.on('data', (c) => { n += c.length; if (n <= max) chunks.push(c); }); s.on('end', () => res(Buffer.concat(chunks))); s.on('error', rej);
  }));
}
const stripXml = (x) => x.replace(/<\/(w:p|a:p|text:p|si|row)>/g, '\n').replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/[ \t]+/g, ' ').replace(/\n\s*\n+/g, '\n').trim();

// Screenshot + poke an HTML build (file:// so it works with APP_PASSWORD on). Returns asset paths and runtime info.
async function shootHtml(htmlFile, assetsDir, tag, api) {
  if (!browser.chromePath()) { api.log('No Chrome found: skipped HTML screenshots (code is still read)'); return { shots: [], info: 'not run (no Chrome)' }; }
  try {
    const v = await browser.validateGame(pathToFileURL(htmlFile).href);
    const a = path.join(assetsDir, `${tag}-start.png`), b = path.join(assetsDir, `${tag}-play.png`);
    fs.writeFileSync(a, v.startShot); fs.writeFileSync(b, v.playShot);
    return { shots: [a, b], info: `${v.ok ? 'ran with no errors' : `issues: ${v.errors.slice(0, 5).join(' | ')}`}; canvases ${v.info.canvases}, DOM elements ${v.info.elements}${v.info.bodyText ? `, visible text "${v.info.bodyText.replace(/\s+/g, ' ').slice(0, 120)}"` : ''}` };
  } catch (e) { api.log(`HTML screenshot failed: ${e.message}`); return { shots: [], info: `could not load in headless Chrome (${e.message.slice(0, 120)})` }; }
}

async function videoFrames(file, assetsDir, tag, api, n = 8) {
  const out = [];
  if (await has(ffmpegBin())) {
    let dur = 0;
    if (await has(ffprobeBin())) { const p = await run(ffprobeBin(), ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', file]); dur = parseFloat(p.stdout) || 0; }
    const times = dur > 0 ? Array.from({ length: n }, (_, i) => (dur * (i + 0.5)) / n) : Array.from({ length: n }, (_, i) => i * 2);
    for (let i = 0; i < times.length; i++) {
      const dest = path.join(assetsDir, `${tag}-f${String(i + 1).padStart(2, '0')}.jpg`);
      const r = await run(ffmpegBin(), ['-y', '-loglevel', 'error', '-ss', times[i].toFixed(2), '-i', file, '-frames:v', '1', '-vf', 'scale=720:-2', '-q:v', '4', dest], { timeout: 60000 });
      if (r.ok && fs.existsSync(dest) && fs.statSync(dest).size > 0) out.push(dest);
    }
    if (out.length) return { frames: out, method: `ffmpeg (${out.length} keyframes${dur ? ` across ${dur.toFixed(1)} s` : ''})`, duration: dur };
  }
  // Fallback: let headless Chrome play the video and grab frames (works for mp4/webm Chrome can decode).
  if (browser.chromePath()) {
    try {
      const res = await browser.withPage(async (page) => {
        await page.goto(pathToFileURL(file).href, { waitUntil: 'load', timeout: 30000 });
        const dur = await page.evaluate(() => new Promise((r) => { const v = document.querySelector('video'); if (!v) return r(0); const go = () => r(v.duration || 0); if (v.readyState >= 1) go(); else { v.onloadedmetadata = go; setTimeout(go, 8000); } }));
        if (!dur || !Number.isFinite(dur)) return { frames: [], dur: 0 };
        const frames = [];
        for (let i = 0; i < n; i++) {
          await page.evaluate((t) => new Promise((r) => { const v = document.querySelector('video'); v.pause(); v.onseeked = () => r(); v.currentTime = t; setTimeout(r, 4000); }), (dur * (i + 0.5)) / n);
          const el = await page.$('video'); const dest = path.join(assetsDir, `${tag}-f${String(i + 1).padStart(2, '0')}.png`);
          await el.screenshot({ path: dest }); frames.push(dest);
        }
        return { frames, dur };
      }, { width: 720, height: 1280, deviceScaleFactor: 1, isMobile: false, hasTouch: false });
      if (res.frames.length) return { frames: res.frames, method: `headless Chrome (${res.frames.length} frames; install ffmpeg for any codec)`, duration: res.dur };
    } catch (e) { api.log(`Chrome video fallback failed: ${e.message}`); }
  }
  return { frames: [], method: 'no frames (install ffmpeg to read this video)' };
}

const APP_ENGINES = [[/libunity\.so|assets\/bin\/Data\//, 'Unity'], [/libUE4\.so|libUnreal\.so/, 'Unreal'], [/libcocos/i, 'Cocos'], [/libgodot|\.pck$/, 'Godot'], [/libflutter\.so/, 'Flutter'], [/libdmengine/, 'Defold'], [/libyoyo\.so/, 'GameMaker'], [/libreactnativejni|index\.android\.bundle/, 'React Native'], [/UnityFramework/, 'Unity (iOS)'], [/libsolar2d|libcorona/, 'Solar2D']];

// Extract one uploaded file -> { file, kind, size, summary, images: [paths], text, hasBuild, hasVideo }
async function extractOne(f, dir, idx, api) {
  const assets = path.join(dir, 'assets'); fs.mkdirSync(assets, { recursive: true });
  const tag = `u${idx + 1}`; const kind = kindOf(f.name, f.mime);
  const item = { file: f.name, kind, size: f.size, summary: '', images: [], text: '', hasBuild: false, hasVideo: false };
  try {
    if (kind === 'image') {
      try { item.images.push(await toPng(f.path, path.join(assets, `${tag}.png`))); item.summary = 'image'; } catch (e) { item.summary = `image (could not decode: ${e.message.slice(0, 80)})`; }
    } else if (kind === 'video') {
      const v = await videoFrames(f.path, assets, tag, api); item.images.push(...v.frames); item.hasVideo = v.frames.length > 0;
      item.summary = `video${v.duration ? `, ${v.duration.toFixed(1)} s` : ''}; frames via ${v.method}`;
    } else if (kind === 'html') {
      const s = await shootHtml(f.path, assets, tag, api); item.images.push(...s.shots); item.hasBuild = true;
      item.text = readHead(f.path, 60000); item.summary = `HTML build; headless Chrome: ${s.info}`;
    } else if (kind === 'zip' || kind === 'app') {
      const { zip, list } = await zipEntries(f.path);
      const names = list.map((x) => x.name);
      const engine = APP_ENGINES.filter(([re]) => names.some((n) => re.test(n))).map(([, e]) => e);
      const htmls = list.filter((x) => /\.html?$/i.test(x.name) && !/__MACOSX/.test(x.name)).sort((a, b) => a.name.split('/').length - b.name.split('/').length || (/index\.html?$/i.test(b.name) - /index\.html?$/i.test(a.name)));
      item.summary = `${kind === 'app' ? 'app package' : 'zip'}: ${list.length} files${engine.length ? `; engine looks like ${[...new Set(engine)].join(', ')}` : ''}`;
      item.text = `File list (first 150):\n${names.slice(0, 150).join('\n')}\n`;
      if (kind === 'zip' && htmls.length && list.length < 5000) {
        zip.close(); const ex = path.join(dir, 'build', tag); fs.mkdirSync(ex, { recursive: true });
        await require('extract-zip')(f.path, { dir: ex });
        const main = path.join(ex, htmls[0].name); item.hasBuild = true;
        const s = await shootHtml(main, assets, tag, api); item.images.push(...s.shots);
        let code = `\n--- ${htmls[0].name} ---\n${readHead(main, 40000)}\n`;
        for (const x of list.filter((x) => /\.(js|mjs|ts|json)$/i.test(x.name) && !/node_modules|__MACOSX|\.min\./.test(x.name)).slice(0, 12)) {
          if (code.length > 90000) break; const p = path.join(ex, x.name); if (fs.existsSync(p)) code += `\n--- ${x.name} ---\n${readHead(p, 15000)}\n`;
        }
        item.text += code; item.summary += `; H5 build (${htmls[0].name}); headless Chrome: ${s.info}`;
      } else {
        // pull a few useful images (icons, screenshots) and readable text without extracting everything
        const imgs = list.filter((x) => /\.(png|jpe?g|webp)$/i.test(x.name) && x.size > 3000 && x.size < 8e6 && !/__MACOSX/.test(x.name))
          .sort((a, b) => (/(ic_launcher|appicon|icon|screenshot|splash)/i.test(b.name) - /(ic_launcher|appicon|icon|screenshot|splash)/i.test(a.name)) || b.size - a.size).slice(0, 4);
        let k = 0;
        for (const x of imgs) { try { const buf = await readEntry(zip, x.e); const tmp = path.join(assets, `${tag}-z${++k}.src`); fs.writeFileSync(tmp, buf); item.images.push(await toPng(tmp, path.join(assets, `${tag}-z${k}.png`), 720)); fs.rmSync(tmp, { force: true }); } catch {} }
        for (const x of list.filter((x) => /\.(txt|md|json|html?|xml|csv)$/i.test(x.name) && x.size < 2e6 && !/^(res|META-INF)\//.test(x.name)).slice(0, 6)) {
          if (item.text.length > 60000) break; try { const b = await readEntry(zip, x.e, 20000); if (!b.includes(0)) item.text += `\n--- ${x.name} ---\n${b.toString('utf8').slice(0, 15000)}\n`; } catch {}
        }
        zip.close();
        if (kind === 'app') item.summary += ' (native packages cannot be played here; add a gameplay video for a medium-confidence rating)';
      }
    } else if (kind === 'pdf') {
      if (await has('pdftotext')) { const r = await run('pdftotext', ['-layout', '-l', '30', f.path, '-']); item.text = r.stdout.slice(0, 60000); }
      if (await has('pdftoppm')) {
        const r = await run('pdftoppm', ['-png', '-r', '60', '-l', '4', f.path, path.join(assets, `${tag}-p`)]);
        if (r.ok) item.images.push(...fs.readdirSync(assets).filter((n) => n.startsWith(`${tag}-p`)).sort().map((n) => path.join(assets, n)));
      }
      item.summary = `PDF${item.text ? `, ${item.text.length} chars of text` : ' (install poppler for text: brew install poppler)'}${item.images.length ? `, ${item.images.length} page images` : ''}`;
    } else if (kind === 'office') {
      const { zip, list } = await zipEntries(f.path).catch(() => ({ list: [] }));
      const want = list.filter((x) => /^(word\/document|ppt\/slides\/slide\d+|xl\/sharedStrings|content)\.xml$/.test(x.name)).sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
      for (const x of want) { if (item.text.length > 60000) break; item.text += stripXml((await readEntry(zip, x.e)).toString('utf8')) + '\n'; }
      const media = list.filter((x) => /media\/.*\.(png|jpe?g)$/i.test(x.name) && x.size > 5000).sort((a, b) => b.size - a.size).slice(0, 4);
      let k = 0; for (const x of media) { try { const tmp = path.join(assets, `${tag}-m${++k}.src`); fs.writeFileSync(tmp, await readEntry(zip, x.e)); item.images.push(await toPng(tmp, path.join(assets, `${tag}-m${k}.png`), 960)); fs.rmSync(tmp, { force: true }); } catch {} }
      zip?.close?.(); item.summary = `document: ${item.text.length} chars of text${item.images.length ? `, ${item.images.length} embedded images` : ''}`;
    } else if (kind === 'text' || looksText(f.path)) {
      item.kind = 'text'; item.text = readHead(f.path, 40000); item.summary = `text, ${item.text.length} chars`;
    } else {
      item.summary = `binary file (${f.mime || 'unknown type'}); only its name and size were used`;
    }
  } catch (e) { item.summary = `${kind}: extraction failed (${e.message.slice(0, 120)})`; api.log(`${f.name}: ${e.message}`); }
  item.text = item.text.slice(0, 90000);
  return item;
}

// ---------- prompt ----------
function rubricText() {
  const rd = (f) => { try { return fs.readFileSync(path.join(RUBRIC_DIR, f), 'utf8'); } catch { return ''; } };
  let arche = ''; try { const a = JSON.parse(rd('archetypes.json')).archetypes || {}; arche = Object.entries(a).map(([k, v]) => `${k}: input ${v.input}, hook ${v.hook}, mon ${v.mon}, feas ${v.feas}, wave ${v.wave}${v.saturated ? ' (saturated)' : ''}, depth ${v.depth} - ${v.why}`).join('\n'); } catch {}
  return { scoring: rd('SCORING_V2.md'), idea: rd('IDEA_RATING.md'), arche };
}
function catalogueLines(games) {
  return games.map((g) => `${g.id} | ${g.name} | ${g.category} | ${(g.genres || []).slice(0, 4).join(', ')} | ${g.input_type || ''} | overall ${g.overall} | mom ${g.scores.momentum} stay ${g.scores.staying} size ${g.scores.size} | ${String(g.reason || '').slice(0, 110)}`).join('\n');
}
const SYSTEM = 'You are Pintu, Anurag\'s hybrid-casual game rater. You rate an uploaded game, build, video, mockup or design doc with Pintu scoring v2 exactly as written in the rubric. Be honest and specific: name what you actually saw. You judge; a script applies the weights, borrow rules and caps, so return the judged numbers precisely as asked.';
function buildPrompt({ meta, items, cat, rub, imageRefs }) {
  return `# Rate this game with Pintu scoring v2

## Rubric (Pintu's SCORING_V2.md)
${rub.scoring}

## How to rate an uploaded idea or build (Pintu's IDEA_RATING.md) - follow these steps
${rub.idea}

## Archetypes (Pintu's judgement presets: use the closest as a starting point, then adjust to what you see)
${rub.arche}

## What the player uploaded
Game name: ${meta.name || '(not given)'}
Genre: ${meta.genre || '(not given)'}
Notes from the player: ${meta.notes || '(none)'}

Files and what was extracted:
${items.map((it, i) => `${i + 1}. ${it.file} (${fmtSize(it.size)}): ${it.summary}`).join('\n')}

${imageRefs ? `### Visuals (screenshots, video keyframes, page images). OPEN AND LOOK AT EVERY ONE with your read tool before judging:\n${imageRefs}\n` : '### Visuals\nNone available.\n'}
### Extracted text / code
${items.filter((it) => it.text).map((it) => `<<< ${it.file} >>>\n${it.text.slice(0, Math.floor(110000 / Math.max(1, items.filter((x) => x.text).length)))}`).join('\n\n') || '(none)'}

## Pintu's rated catalogue (${cat.length} live games; id | name | category | genres | input | overall | v2 momentum, staying, size | reason)
${catalogueLines(cat)}

## Your task
1. Deconstruct the game (core mechanic, extra mechanics, core input type code, meta, theme, monetisation).
2. Pick the 3-5 closest live comparables FROM THE CATALOGUE ABOVE (use their exact ids), with similarity 3 = near-identical, 2 = same sub-genre, 1 = loosely related. The script borrows momentum, staying power and size from them (weighted median minus 1), so choose carefully.
3. Judge the clone-wave stage (A3, 1-10) of this combination and whether it is saturated (200+ clones/yr).
4. Judge hook clarity + retry urge (1-10), the input code and input score within its band (Anurag's rules; only core-gameplay gestures count; drag-to-merge is drag_merge, never tap_swipe), monetisation fit (anchors: 1 interstitials only, 5 rewarded + no-ads, 8 fail offers/boosters/lives, 10 continue-beats-restart + pass; judge the fit/potential if monetisation is not shown), theme & live-ops (1-10), feasibility & twist (1-10).
5. Mashup: only if the core loop really combines 2+ mechanics; then give the 5 checks (0-2 each) with a short reason each.
6. If the upload contains real test KPIs (D1, D7, CPI) report them, otherwise null.
7. Strengths, weaknesses, and the top 2-3 concrete changes that would raise the score (name the pillar each one lifts).

Reply with ONLY this JSON (no prose, no code fences):
{"game_name":"","one_line":"one sentence: what the game is and the single biggest reason for its score","evidence_seen":"what you could actually see / play / read",
"deconstruct":{"core_mechanic":"","extra_mechanics":[],"meta":"","theme":"","monetisation":"","genre_tags":[]},
"archetype":"closest archetype key",
"comparables":[{"id":"exact catalogue id","similarity":3,"why":""}],
"wave":{"score":0,"saturated":false,"reason":""},
"hook":{"clarity":0,"reason":""},
"input":{"code":"tap_simple|tap_complex|drag|swipe|tap_double|tap_double_optional|drag_merge|tap_swipe|multi","score":0,"reason":""},
"monetisation":{"score":0,"reason":""},
"theme":{"score":0,"reason":""},
"feasibility":{"score":0,"reason":""},
"mashup":{"applies":false,"mechanics":[],"checks":[0,0,0,0,0],"check_reasons":["","","","",""]},
"kpis":{"d1":null,"d7":null,"cpi_usd":null,"source":""},
"strengths":[""],"weaknesses":[""],
"improvements":[{"change":"","pillar":"","why":""}],
"summary":"3-5 sentences: why this game lands where it does under Pintu v2"}`;
}

function mockJudgement(meta, items, cat) {
  const comps = keywordComparables(`${meta.name} ${meta.genre} ${meta.notes}`, cat, 4);
  return { game_name: meta.name || 'Demo upload', one_line: 'Demo-mode rating (no AI call): numbers are placeholders.', evidence_seen: items.map((i) => i.summary).join('; '),
    deconstruct: { core_mechanic: meta.genre || 'sort', extra_mechanics: [], meta: 'levels', theme: 'unknown', monetisation: 'unknown', genre_tags: [] }, archetype: 'sort_tap',
    comparables: comps.map((c) => ({ id: c.game.id, similarity: 2, why: 'keyword match' })), wave: { score: 5, saturated: true, reason: 'Demo' }, hook: { clarity: 7, reason: 'Demo' },
    input: { code: 'tap_simple', score: 10, reason: 'Demo' }, monetisation: { score: 6, reason: 'Demo' }, theme: { score: 6, reason: 'Demo' }, feasibility: { score: 7, reason: 'Demo' },
    mashup: { applies: false }, kpis: {}, strengths: ['Demo strength'], weaknesses: ['Demo weakness'], improvements: [{ change: 'Turn off demo mode for a real rating', pillar: 'all', why: '' }], summary: 'Demo mode result.' };
}

// ---------- job ----------
async function rateJob(api, ai, { id, meta }) {
  const dir = dirOf(id); const up = path.join(dir, 'uploads');
  const uploads = JSON.parse(fs.readFileSync(path.join(dir, 'uploads.json'), 'utf8'));
  api.step(0, 'done', `${uploads.length} file${uploads.length === 1 ? '' : 's'}, ${fmtSize(uploads.reduce((a, f) => a + f.size, 0))}`);
  api.step(1, 'active');
  fs.rmSync(path.join(dir, 'assets'), { recursive: true, force: true }); fs.rmSync(path.join(dir, 'build'), { recursive: true, force: true });
  const items = [];
  for (let i = 0; i < uploads.length; i++) { api.log(`Reading ${uploads[i].name}…`); const it = await extractOne({ ...uploads[i], path: path.join(up, uploads[i].stored) }, dir, i, api); items.push(it); api.log(`${it.file}: ${it.summary}`); }
  const images = items.flatMap((it) => it.images).slice(0, 18);
  const thumbSrc = images[0];
  if (thumbSrc) { try { await require('sharp')(thumbSrc).resize(360, 360, { fit: 'cover', position: 'top' }).jpeg({ quality: 80 }).toFile(path.join(dir, 'thumb.jpg')); } catch {} }
  api.step(1, 'done', `${images.length} visual${images.length === 1 ? '' : 's'}, ${items.reduce((a, it) => a + it.text.length, 0)} chars of text`);

  api.step(2, 'active');
  const catInfo = v2Catalogue(); const cat = catInfo.games;
  api.log(`Pintu catalogue for comparables: ${cat.length} games (${catInfo.source})`);
  const rub = rubricText();
  let j;
  if (ai.ctx.mock) j = mockJudgement(meta, items, cat);
  else {
    const isCursor = ai.ctx.provider === 'cursor-agent';
    const sharp = require('sharp');
    let imageRefs = ''; const files = []; const b64 = [];
    for (let i = 0; i < images.length; i++) {
      const name = `visuals/${String(i + 1).padStart(2, '0')}-${path.basename(images[i]).replace(/\.[^.]+$/, '')}.jpg`;
      const buf = await sharp(images[i]).resize({ width: 900, height: 900, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 80 }).toBuffer();
      if (isCursor) { files.push({ name, data: buf }); imageRefs += `- {{WS}}/${name}\n`; }
      else if (b64.length < 8) { b64.push({ mime: 'image/jpeg', data: buf.toString('base64') }); imageRefs += `- image ${b64.length} attached: ${path.basename(images[i])}\n`; }
    }
    const prompt = buildPrompt({ meta, items, cat, rub, imageRefs });
    api.log(`Asking ${ai.ctx.provider} to judge with Pintu v2 (${images.length} visuals, prompt ${Math.round(prompt.length / 1000)} KB)… this takes 1-5 minutes`);
    const ask = (extra = '') => ai.text({ system: SYSTEM, prompt: prompt + extra, images: b64, files, json: true, timeoutMs: (Number(process.env.RATE_TIMEOUT_MIN || 0) || 12) * 60000 });
    try { j = await ask(); } catch (e) {
      if (e.status && e.status < 500 && e.status !== 502) throw e;
      api.log(`First answer unusable (${e.message.slice(0, 100)}), retrying once…`);
      j = await ask('\n\nIMPORTANT: your previous reply was not valid JSON. Reply with the JSON object only.');
    }
  }
  api.step(2, 'done');

  api.step(3, 'active');
  const byId = new Map(cat.map((g) => [g.id, g]));
  let comps = (Array.isArray(j.comparables) ? j.comparables : []).map((c) => ({ game: byId.get(c.id) || cat.find((g) => g.name.toLowerCase() === String(c.name || c.id || '').toLowerCase()), similarity: c.similarity, why: c.why })).filter((c) => c.game);
  comps = comps.filter((c, i) => comps.findIndex((x) => x.game.id === c.game.id) === i).slice(0, 5);
  if (comps.length < 3) {
    const extra = keywordComparables(`${meta.name} ${meta.genre} ${j.deconstruct?.core_mechanic} ${(j.deconstruct?.extra_mechanics || []).join(' ')} ${(j.deconstruct?.genre_tags || []).join(' ')}`, cat, 6).filter((x) => !comps.some((c) => c.game.id === x.game.id));
    comps.push(...extra.slice(0, 3 - comps.length)); if (extra.length) api.log('Added keyword-matched comparables (AI gave fewer than 3 valid ids)');
  }
  const hasBuild = items.some((i) => i.hasBuild), hasVideo = items.some((i) => i.hasVideo);
  const sc = S.scoreIdea(j, comps, { hasBuild, hasVideo, kpis: j.kpis });
  const ranked = [...sc.pillars].sort((a, b) => b.score - a.score);
  const drivers = `Strongest: ${ranked.slice(0, 2).map((p) => `${p.label} ${p.score}`).join(', ')}. Weakest: ${ranked.slice(-2).reverse().map((p) => `${p.label} ${p.score}`).join(', ')}.${sc.cap ? ` Capped at ${sc.cap.startsWith('mashup') ? '6.0' : '5.0'}: ${sc.cap}.` : ''}`;
  const { readRatings: rr } = require('./data'); const icons = new Map(rr().games.map((g) => [g.id, g.icon_local || g.icon_remote]));
  const report = {
    id, created_at: new Date().toISOString(), rubric_version: S.RUBRIC_VERSION, provider: ai.ctx.mock ? 'demo' : ai.ctx.provider,
    meta: { name: meta.name || j.game_name || uploads[0]?.name || 'Untitled', genre: meta.genre || (j.deconstruct?.genre_tags || []).slice(0, 2).join(', '), notes: meta.notes || '' },
    files: items.map(({ file, kind, size, summary, images: im }) => ({ file, kind, size, summary, visuals: im.map((p) => `/rated/${id}/${path.relative(dir, p).split(path.sep).join('/')}`) })),
    thumb: fs.existsSync(path.join(dir, 'thumb.jpg')) ? `/rated/${id}/thumb.jpg` : null,
    score: sc, overall: sc.overall, confidence: sc.confidence, short_reason: `${j.one_line || ''} ${drivers}`.trim(), drivers,
    one_line: j.one_line || '', summary: j.summary || '', evidence_seen: j.evidence_seen || '', deconstruct: j.deconstruct || {}, archetype: j.archetype || null,
    comparables: comps.map((c) => ({ id: c.game.id, name: c.game.name, category: c.game.category, overall: c.game.overall, scores: { momentum: c.game.scores.momentum, staying: c.game.scores.staying, size: c.game.scores.size }, similarity: c.similarity || 1, why: c.why || '', store_url: require('./data').expandUrl(c.game.store_url), icon: icons.get(c.game.id) || null })),
    strengths: j.strengths || [], weaknesses: j.weaknesses || [], improvements: j.improvements || [], kpis: j.kpis || {},
    comparables_source: `${catInfo.source}${catInfo.updated_at ? ` (Pintu updated ${catInfo.updated_at})` : ''}`,
  };
  fs.writeFileSync(path.join(dir, 'report.json'), JSON.stringify(report, null, 1));
  const d = readCatalogue(); d.games = d.games.filter((g) => g.id !== id);
  d.games.unshift({ id, name: report.meta.name, genre: report.meta.genre, created_at: report.created_at, overall: sc.overall, overall_uncapped: sc.overall_uncapped, cap: sc.cap, confidence: sc.confidence,
    rubric_version: S.RUBRIC_VERSION, thumb: report.thumb, short_reason: report.short_reason, one_line: report.one_line, drivers,
    scores: Object.fromEntries(sc.pillars.map((p) => [p.key, p.score])), input: sc.input.label, files: items.map((i) => ({ file: i.file, kind: i.kind })), comparables: report.comparables.map((c) => c.name) });
  writeCatalogue(d);
  api.step(3, 'done', `Overall ${sc.overall}/10`);
  api.log(`Saved to catalogue (${d.games.length} rated game${d.games.length === 1 ? '' : 's'})`);
  return { id, overall: sc.overall };
}

// Save multer files into data/rated-games/<id>/uploads and record them.
function saveUploads(id, files) {
  const dir = dirOf(id); const up = path.join(dir, 'uploads'); fs.mkdirSync(up, { recursive: true });
  const used = new Set(); const list = [];
  for (const f of files) {
    const orig = Buffer.from(f.originalname || 'file', 'latin1').toString('utf8'); // multer decodes names as latin1
    let n = safeName(orig); const base = n.replace(/(\.[^.]*)?$/, ''), ext = path.extname(n); let k = 1; while (used.has(n.toLowerCase())) n = `${base}-${++k}${ext}`; used.add(n.toLowerCase());
    fs.renameSync(f.path, path.join(up, n));
    list.push({ name: orig, stored: n, size: f.size, mime: f.mimetype || '' });
  }
  fs.writeFileSync(path.join(dir, 'uploads.json'), JSON.stringify(list, null, 1));
  return list;
}

module.exports = { RATED_DIR, CAT_FILE, newId, validId, dirOf, listRated, getReport, deleteRated, rateJob, saveUploads, v2Catalogue, kindOf, extractOne };
