// Core studio pipeline: themes -> theme previews -> merge summary -> idea (concept + animated mockup + GIF) -> H5 game.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { ROOT, safeKey } = require('./data');
const mock = require('./mock');
const { extractSvg, extractHtml, svgDataUri } = require('./svg');
const browser = require('./browser');
const { framesToGif } = require('./gif');
const { templateGame } = require('./template-game');

const CACHE = path.join(ROOT, 'data', 'cache');
const IDEAS = path.join(ROOT, 'data', 'ideas');
const GAMES = path.join(ROOT, 'games');
const mode = (ai) => (ai.ctx.mock ? 'mock' : ai.ctx.provider);
const gameDir = (ai, game) => { const d = path.join(CACHE, mode(ai), safeKey(game.id)); fs.mkdirSync(d, { recursive: true }); return d; };
const h8 = (o) => crypto.createHash('sha1').update(JSON.stringify(o)).digest('hex').slice(0, 10);
const readJson = (f) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; } };
const slugify = (s) => String(s).toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'game';

const SYS = 'You are Golu, a senior hybrid-casual mobile game designer and art director at a top studio. You know what tops the App Store/Google Play puzzle & casual charts in 2026. Be concrete, original and commercially sharp.';

function gameBrief(game) {
  return `Source game: "${game.name}" by ${game.developer || 'unknown'} (${game.category}; ${game.platform || ''}). Genres: ${(game.genres || []).join(', ')}. Pintu scores: overall ${game.overall_score}, performance ${game.performance_score}, theme ${game.theme_score} (0-10). Pintu theme ideas: ${game.theme_ideas || 'n/a'}. Monetization: ${game.monetization || 'n/a'}. Metrics: ${game.key_metrics || 'n/a'}.`;
}

// ---------- themes ----------
// `mechanics` = the extra mechanics currently picked in "Merge mechanics" (the base game's own loop is
// always included implicitly). Themes are generated for that mashup; the set used is stored as
// data.mechanics so the UI can tell when its selection has drifted and offer "Refresh themes".
// Refreshed sets get a fresh id prefix so cached previews (server file + browser HTTP cache) never
// show an old picture for a new theme.
const mechKey = (mechs) => (mechs || []).map((m) => m.id).sort().join(',');
const mechBlock = (mechs) => (mechs && mechs.length
  ? `Mechanics being merged into this spin-off (on top of the source game's original core loop): ${mechs.map((m) => `${m.name}${m.desc ? ` (${m.desc})` : ''}`).join('; ')}.
Every theme MUST suit this exact mechanic mashup: its pieces/objects should make natural sense to ${mechs.map((m) => m.name.toLowerCase()).join(' and ')}, and each description should say in a few words how the theme expresses the merged mechanics.`
  : 'No extra mechanics are being merged yet: themes should suit the source game\'s original core loop.');

async function getThemes(ai, game, { more = false, refresh = false, mechanics = [] } = {}) {
  const file = path.join(gameDir(ai, game), 'themes.json');
  let cached = readJson(file);
  if (cached && !cached.mechanics) cached.mechanics = [];
  if (cached && !more && !refresh) return cached;
  const extend = !!(cached && more && !refresh);
  const prefix = extend ? (cached.idPrefix || 't') : cached ? `r${Date.now().toString(36)}t` : 't';
  const start = extend ? cached.themes.length : 0;
  const mechs = (mechanics || []).map(({ id, name, desc }) => ({ id, name, desc }));
  const mechNames = mechs.map((m) => m.name);
  let fresh, original = cached?.original_mechanic || null;
  if (ai.ctx.mock) {
    const base = mock.themes(game, mechs);
    fresh = extend ? base.slice(0, 3).map((t, i) => ({ ...t, name: `${t.name} ${['Night', 'Deluxe', 'Festival'][(start + i) % 3]}` })) : base;
  } else {
    const existing = extend ? cached.themes.map((t) => t.name) : [];
    const j = await ai.text({
      system: SYS, json: true, temperature: 1, maxTokens: 4000,
      prompt: `${gameBrief(game)}
${mechBlock(mechs)}

${extend ? `Suggest 5 MORE fresh visual themes that would work for a reskin/spin-off of this game. Do not repeat: ${existing.join('; ')}.` : `List 8 visual themes that would work for a reskin/spin-off of this game. First 2-4 must be derived from Pintu's theme ideas (source "pintu"), the rest your own high-potential ideas (source "ai") based on what themes trend in hybrid-casual right now.`}
Also describe the source game's ORIGINAL core mechanic in one sentence (field original_mechanic).
Return JSON: {"original_mechanic": string, "themes": [{"name": string (2-4 words), "description": string (1-2 sentences: setting, pieces, mood${mechs.length ? ', how it fits the merged mechanics' : ''}), "palette": [4 hex colours], "motifs": [3 short object words], "source": "pintu"|"ai"}]}`,
    });
    fresh = j.themes || [];
    original = original || j.original_mechanic || null;
  }
  fresh = fresh.map((t, i) => ({ ...t, id: `${prefix}${start + i}`, mechanics: mechNames }));
  const data = extend
    ? { ...cached, original_mechanic: original, themes: [...cached.themes, ...fresh] }
    : { original_mechanic: original, idPrefix: prefix, mechanics: mechs.map(({ id, name }) => ({ id, name })), mechKey: mechKey(mechs), generatedAt: Date.now(), themes: fresh };
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
  return data;
}

async function themePreview(ai, game, themeId) {
  const dir = gameDir(ai, game);
  const file = path.join(dir, `theme_${safeKey(themeId)}.svg`);
  if (fs.existsSync(file)) return file;
  const { themes } = await getThemes(ai, game);
  const theme = themes.find((t) => t.id === themeId);
  if (!theme) throw Object.assign(new Error('Unknown theme'), { status: 404 });
  let svg;
  if (ai.ctx.mock) svg = mock.themeSvg(theme);
  else {
    const out = await ai.text({
      system: 'You are an expert vector illustrator for mobile game key art. You output only raw SVG markup.', temperature: 0.8, maxTokens: 9000,
      prompt: `${gameBrief(game)}
Theme: "${theme.name}" - ${theme.description}.${theme.mechanics?.length ? ` The spin-off merges in: ${theme.mechanics.join(' + ')}, so the board should hint at those mechanics too.` : ''} Palette: ${(theme.palette || []).join(', ')}. Motifs: ${(theme.motifs || []).join(', ')}.
Draw a polished square preview (viewBox="0 0 400 400") showing how ${game.name}'s gameplay board would LOOK reskinned in this theme: a close-up of the play-field with themed pieces, a themed backdrop, soft lighting (gradients, highlights, drop shadows via filters), and a small banner with the theme name. Rich, glossy, release-quality casual-game look. No external images or fonts, no <script>, no <foreignObject>. Keep it under ~250 elements. Output ONLY the <svg>...</svg>.`,
    });
    svg = extractSvg(out);
  }
  fs.writeFileSync(file, svg);
  return file;
}

// ---------- mechanic merge summary ----------
async function mergeSummary(ai, game, theme, mechs) {
  const key = h8({ g: game.id, t: theme?.name, m: mechs.map((m) => m.id).sort() });
  const file = path.join(gameDir(ai, game), `merge_${key}.json`);
  const c = readJson(file); if (c) return c;
  let summary;
  if (ai.ctx.mock) summary = mock.mergeSummary(game, theme || { name: 'Original' }, mechs);
  else {
    summary = (await ai.text({
      system: SYS, temperature: 0.9, maxTokens: 600,
      prompt: `${gameBrief(game)}\nTheme: ${theme?.name || 'original'}${theme ? ` (${theme.description})` : ''}.\nMerge these mechanics into ONE coherent hybrid-casual game: ${mechs.map((m) => `${m.name} - ${m.desc}`).join(' | ')}.\nWrite a punchy 2-3 sentence concept summary of how they merge into one core loop (no title, no markdown).`,
    })).trim();
  }
  const r = { summary };
  fs.writeFileSync(file, JSON.stringify(r));
  return r;
}

// ---------- ideas ----------
function listIdeas(gameId) {
  if (!fs.existsSync(IDEAS)) return [];
  return fs.readdirSync(IDEAS).map((d) => readJson(path.join(IDEAS, d, 'idea.json'))).filter((x) => x && (!gameId || x.gameId === gameId)).sort((a, b) => b.createdAt - a.createdAt);
}
function getIdea(id) { return readJson(path.join(IDEAS, safeKey(id), 'idea.json')); }

async function ideaJob(api, ai, { game, theme, mechanics, previous = [], baseUrl }) {
  const id = `${slugify(game.name).slice(0, 20)}-${Date.now().toString(36)}`;
  const dir = path.join(IDEAS, id); fs.mkdirSync(dir, { recursive: true });
  const prev = previous.length ? previous : listIdeas(game.id).filter((i) => i.theme?.name === theme.name).slice(0, 8).map((i) => `${i.concept.title}: ${i.concept.hook}`);

  api.step(0); api.log(`Designing concept with ${ai.ctx.mock ? 'mock' : (await ai.models()).text}`);
  let concept;
  if (ai.ctx.mock) concept = mock.concept(game, theme, mechanics, prev.length);
  else concept = await ai.text({
    system: SYS, json: true, temperature: 1, maxTokens: 5000,
    prompt: `${gameBrief(game)}
Chosen theme: "${theme.name}" - ${theme.description} (palette ${(theme.palette || []).join(', ')}).
Mechanics to merge: ${mechanics.map((m) => `${m.name} (${m.desc})`).join('; ')}.
${prev.length ? `Previous ideas under the same constraints (yours must be clearly DIFFERENT in title, hook and core loop):\n- ${prev.join('\n- ')}` : ''}
Design one original, commercially strong hybrid-casual mobile game (portrait, one-thumb) that merges these mechanics in the chosen theme and is simple enough to build as a single-file HTML5 canvas game.
Return JSON: {"title","tagline","hook","core_loop":[4-6 steps],"mechanics_merge","art_direction","palette":[5 hex],"progression","monetization","controls","win_lose","sprites":[4-7 {"key": camelCase id, "description": what the sprite depicts}],"item_names":[names of the main collectible/piece types],"animation_beats":[5 short beats of a 4-second gameplay loop for an animated mockup]}`,
  });
  api.log(`Concept: ${concept.title}`);

  api.step(1); api.log('Drawing animated mockup (HTML/SVG/CSS)');
  let html;
  if (ai.ctx.mock) html = mock.mockupHtml(concept);
  else {
    const out = await ai.text({
      system: 'You are a senior UI artist + front-end animator who builds pixel-perfect animated mobile game mockups in pure HTML/CSS/SVG. Output only a complete HTML document.',
      temperature: 0.8, maxTokens: 20000,
      prompt: `Build an animated gameplay mockup for this mobile game concept:\n${JSON.stringify(concept, null, 1)}
Requirements:
- Single self-contained HTML document; body exactly 390x844 px (portrait phone), overflow hidden, no scrollbars.
- NO external resources (no images, fonts, CDNs). Draw everything with inline SVG, CSS gradients, shadows, filters; emoji only as small accents.
- Must look like a real release-quality screenshot of the game mid-play: top HUD (level, score/currency, moves/timer), the themed play-field with the merged mechanics clearly visible, themed background, booster buttons, a tutorial finger.
- Animate a seamless 4-second loop (CSS @keyframes and/or requestAnimationFrame) that plays these beats: ${(concept.animation_beats || []).join(' -> ')}. Include juicy feedback (sparkles, pop scale, floating score text).
- Starts automatically, needs no interaction, deterministic.
Output ONLY the HTML.`,
    });
    html = extractHtml(out);
  }
  fs.writeFileSync(path.join(dir, 'mockup.html'), html);

  api.step(2); api.log('Capturing frames in headless Chromium');
  const url = `${baseUrl}/ideas/${id}/mockup.html`;
  let gifOk = false, frameCount = 0, gifError = null;
  try {
    const frames = await browser.captureFrames(url, { frames: 20, durationMs: 4000 });
    fs.writeFileSync(path.join(dir, 'mockup.png'), frames[Math.floor(frames.length * 0.6)]);
    for (let i = 0; i < frames.length; i += 4) { fs.writeFileSync(path.join(dir, `frame_${frameCount}.png`), frames[i]); frameCount++; }
    api.step(3); api.log('Encoding GIF');
    fs.writeFileSync(path.join(dir, 'preview.gif'), await framesToGif(frames, { width: 300, delay: 200 }));
    gifOk = true;
  } catch (e) { gifError = e.message; api.log(`GIF failed: ${e.message}`); api.step(3, 'error', e.message); }

  const idea = { id, gameId: game.id, gameName: game.name, theme, mechanics: mechanics.map(({ id, name, desc }) => ({ id, name, desc })), concept, createdAt: Date.now(), provider: mode(ai), model: ai.ctx.mock ? 'mock' : (await ai.models()).text, files: { mockupHtml: `/ideas/${id}/mockup.html`, still: frameCount ? `/ideas/${id}/mockup.png` : null, gif: gifOk ? `/ideas/${id}/preview.gif` : null, frames: Array.from({ length: frameCount }, (_, i) => `/ideas/${id}/frame_${i}.png`) }, gifError };
  fs.writeFileSync(path.join(dir, 'idea.json'), JSON.stringify(idea, null, 2));
  return idea;
}

// ---------- H5 ----------
function parseSvgBlocks(text) {
  const out = {};
  const re = /===\s*([A-Za-z0-9_-]+)\s*===\s*([\s\S]*?)(?====\s*[A-Za-z0-9_-]+\s*===|$)/g;
  let m; while ((m = re.exec(text))) { try { out[m[1]] = extractSvg(m[2]); } catch {} }
  return out;
}

async function makeAssets(ai, concept) {
  if (ai.ctx.mock) return mock.assets(concept);
  const sys = 'You are a top mobile-game vector artist. You draw polished, glossy, release-quality casual game art as SVG (gradients, highlights, soft shadows, outlines). No external images/fonts, no scripts.';
  const ctx = `Game: ${concept.title} - ${concept.tagline}\nArt direction: ${concept.art_direction}\nPalette: ${(concept.palette || []).join(', ')}`;
  const sprites = concept.sprites || [];
  const [envTxt, sprTxt] = await Promise.all([
    ai.text({ system: sys, temperature: 0.7, maxTokens: 14000, prompt: `${ctx}\nDraw 2 SVGs:\n1. background: viewBox="0 0 390 844" portrait gameplay backdrop (themed scenery, depth, keep the middle area calm/low-contrast so pieces read clearly, no UI, no text).\n2. icon: viewBox="0 0 256 256" app-store icon (rounded square, bold hero character/object, no text).\nOutput format exactly:\n=== background ===\n<svg ...>...</svg>\n=== icon ===\n<svg ...>...</svg>` }),
    ai.text({ system: sys, temperature: 0.7, maxTokens: 16000, prompt: `${ctx}\nDraw ${sprites.length} game sprites, each viewBox="0 0 128 128", TRANSPARENT background, the object filling ~85% of the box, readable at 48px, consistent style, each clearly distinguishable by colour AND shape:\n${sprites.map((s) => `- ${s.key}: ${s.description}`).join('\n')}\nOutput format exactly, one block per sprite:\n=== <key> ===\n<svg ...>...</svg>` }),
  ]);
  const env = parseSvgBlocks(envTxt), spr = parseSvgBlocks(sprTxt);
  const fallback = mock.assets(concept);
  return { background: env.background || fallback.background, icon: env.icon || fallback.icon, sprites: Object.fromEntries(sprites.map((s) => [s.key, spr[s.key] || fallback.sprites[s.key] || Object.values(fallback.sprites)[0]])) };
}

function injectAssets(code, assets) {
  const tag = `<script>/* Golu Studio asset bundle (SVG data URIs) */window.ASSETS=${JSON.stringify({ background: svgDataUri(assets.background), icon: svgDataUri(assets.icon), sprites: Object.fromEntries(Object.entries(assets.sprites).map(([k, v]) => [k, svgDataUri(v)])) })};</script>`;
  if (/<head[^>]*>/i.test(code)) return code.replace(/<head[^>]*>/i, (m) => `${m}\n${tag}`);
  return tag + code;
}

const H5_RULES = (concept, assets) => `Build the COMPLETE, fully playable, release-quality HTML5 mobile game for this concept:
${JSON.stringify(concept, null, 1)}

Hard requirements:
- ONE self-contained HTML file: vanilla JS + <canvas> 2D (no libraries, no CDN, no network, no external fonts/images).
- Art: the page will receive a global \`window.ASSETS\` (injected by the host in <head>, do NOT define it yourself) = { background: dataURI, icon: dataURI, sprites: { ${Object.keys(assets.sprites).join(', ')} } } — SVG data URIs. Load them with new Image(); draw them as the main art. If an image is not loaded yet, draw a styled vector fallback. Sprite meanings: ${(concept.sprites || []).map((s) => `${s.key}=${s.description}`).join('; ')}.
- A reference screenshot of the intended look is attached; match its layout, palette and polish.
- Screens/flow: animated title/start screen with icon + PLAY button; first-time tutorial hint (animated finger + one-line text); core gameplay implementing ALL merged mechanics (${concept.mechanics_merge}); at least 10 handcrafted or procedurally generated levels with rising difficulty; score, combo, best score in localStorage; win and lose screens with retry/next; pause/restart button.
- Juice: particles, tweens/easing, screen shake, floating score text, button press scale, WebAudio synthesized SFX (create AudioContext on first user gesture) with a mute toggle.
- Portrait layout: logical resolution 390x844 scaled to fit any viewport (letterbox), crisp on high-DPI, touch + mouse via pointer events, preventDefault on touch to avoid scroll.
- The game must start rendering immediately on load, never throw, and be winnable. Tapping the centre of the screen on the title screen must start the game.
- Code quality: one requestAnimationFrame loop with delta time, no blocking alerts/prompts.
Output ONLY the complete HTML document.`;

async function h5Job(api, ai, { idea, baseUrl }) {
  const concept = idea.concept;
  const slug = `${slugify(concept.title)}-${Date.now().toString(36).slice(-5)}`;
  const dir = path.join(GAMES, slug); fs.mkdirSync(path.join(dir, 'assets'), { recursive: true });

  api.step(0); api.log('Drawing SVG art assets (background, icon, sprites)');
  const assets = await makeAssets(ai, concept);
  fs.writeFileSync(path.join(dir, 'assets', 'background.svg'), assets.background);
  fs.writeFileSync(path.join(dir, 'assets', 'icon.svg'), assets.icon);
  for (const [k, v] of Object.entries(assets.sprites)) fs.writeFileSync(path.join(dir, 'assets', `${safeKey(k)}.svg`), v);

  api.step(1);
  let code, model = 'mock-template';
  if (ai.ctx.mock) {
    api.log('Mock mode: using built-in sort+merge game template');
    const keys = Object.keys(assets.sprites);
    code = templateGame({ title: concept.title, tagline: concept.tagline, palette: concept.palette, itemNames: concept.item_names, hint: 'Tap a stack, then tap another to pour matching pieces. Fill a stack to MERGE!', background: svgDataUri(assets.background), icon: svgDataUri(assets.icon), items: keys.map((k) => svgDataUri(assets.sprites[k])) });
  } else {
    model = (await ai.models()).code;
    api.log(`Writing game code with ${model} (this can take a few minutes)`);
    const ideaDir = path.join(IDEAS, safeKey(idea.id));
    const still = path.join(ideaDir, 'mockup.png');
    const images = fs.existsSync(still) ? [{ mime: 'image/png', data: fs.readFileSync(still).toString('base64') }] : [];
    code = extractHtml(await ai.text({ system: 'You are a principal HTML5 game engineer who ships polished, bug-free hybrid-casual web games. You output only complete HTML documents.', images, temperature: 0.6, maxTokens: 48000, prompt: H5_RULES(concept, assets) }, 'code'));
  }

  const write = (c) => fs.writeFileSync(path.join(dir, 'index.html'), ai.ctx.mock ? c : injectAssets(c, assets));
  write(code);

  let report = { ok: false, rounds: [] };
  // Local Create H5 still fixes up to 3 times. The nightly autopilot sets H5_FIX_ROUNDS=1
  // so one stuck build cannot spend the whole job on retries.
  const fixEnv = process.env.H5_FIX_ROUNDS;
  const maxRounds = ai.ctx.mock ? 1 : (fixEnv == null || String(fixEnv).trim() === '' ? 3 : (Number.isFinite(Number(fixEnv)) ? Math.max(0, Math.floor(Number(fixEnv))) : 3));
  for (let round = 0; round <= maxRounds; round++) {
    api.step(2, 'active', `round ${round + 1}`); api.log(`Validating in headless Chromium (round ${round + 1})`);
    let v;
    try { v = await browser.validateGame(`${baseUrl}/games/${slug}/index.html`); } catch (e) { api.log(`Validation unavailable: ${e.message}`); report.skipped = e.message; break; }
    fs.writeFileSync(path.join(dir, 'screenshot.png'), v.playShot);
    fs.writeFileSync(path.join(dir, 'screenshot_start.png'), v.startShot);
    report.rounds.push({ round: round + 1, ok: v.ok, errors: v.errors });
    if (v.ok) { report.ok = true; api.log('Validation passed'); break; }
    api.log(`Found ${v.errors.length} issue(s): ${v.errors[0]}`);
    if (round === maxRounds || ai.ctx.mock) break;
    api.step(2, 'active', `fixing round ${round + 1}`);
    code = extractHtml(await ai.text({ system: 'You are a principal HTML5 game engineer. You fix bugs and return the complete corrected HTML document only.', temperature: 0.3, maxTokens: 48000, prompt: `This HTML5 game produced these runtime problems when loaded in headless Chrome (viewport 390x844, then clicked/tapped around the screen):\n${v.errors.map((e) => `- ${e}`).join('\n')}\n\nNote: window.ASSETS is injected by the host before your code runs (do not define it).\nFix every problem while keeping all features. Return the COMPLETE corrected HTML document.\n\n${code}` }, 'code'));
    write(code);
  }
  api.step(3); api.log('Packaging');
  const meta = { slug, title: concept.title, ideaId: idea.id, gameId: idea.gameId, createdAt: Date.now(), provider: mode(ai), model, validation: report, url: `/games/${slug}/index.html`, zip: `/api/h5/${slug}/zip`, screenshot: fs.existsSync(path.join(dir, 'screenshot.png')) ? `/games/${slug}/screenshot.png` : null };
  fs.writeFileSync(path.join(dir, 'meta.json'), JSON.stringify(meta, null, 2));
  fs.writeFileSync(path.join(dir, 'concept.json'), JSON.stringify(concept, null, 2));
  return meta;
}

function listBuilds(ideaId) {
  if (!fs.existsSync(GAMES)) return [];
  return fs.readdirSync(GAMES).map((d) => readJson(path.join(GAMES, d, 'meta.json'))).filter((m) => m && (!ideaId || m.ideaId === ideaId)).sort((a, b) => b.createdAt - a.createdAt);
}

module.exports = { getThemes, themePreview, mergeSummary, ideaJob, h5Job, listIdeas, getIdea, listBuilds, GAMES, IDEAS, CACHE };
