// Score a built H5 game with Pintu's v2 rubric. The model only judges; lib/scoring-v2.js
// applies weights, borrow rules and caps. Demo mode (no key) uses a deterministic stand-in
// so the keep / discard path can be exercised offline.
const fs = require('fs');
const path = require('path');
const S = require('./scoring-v2');
const { v2Catalogue } = require('./rate');

const RUBRIC_DIR = path.join(__dirname, '..', 'data', 'rubric');
const read = (f) => { try { return fs.readFileSync(path.join(RUBRIC_DIR, f), 'utf8'); } catch { return ''; } };

function rubricBundle() {
  let arche = '';
  try {
    const a = JSON.parse(read('archetypes.json')).archetypes || {};
    arche = Object.entries(a).map(([k, v]) => `${k}: input ${v.input}, hook ${v.hook}, mon ${v.mon}, feas ${v.feas}, wave ${v.wave}${v.saturated ? ' (saturated)' : ''} — ${v.why}`).join('\n');
  } catch { /* archetype list is a hint, not required */ }
  return { scoring: read('SCORING_V2.md'), idea: read('IDEA_RATING.md'), arche };
}

function catalogueLines(games) {
  return games.map((g) => `${g.id} | ${g.name} | ${g.category} | ${(g.genres || []).slice(0, 4).join(', ')} | ${g.input_type || ''} | overall ${g.overall_score ?? g.overall} | mom ${g.scores.momentum} stay ${g.scores.staying} size ${g.scores.size} | ${String(g.reason || '').slice(0, 110)}`).join('\n');
}

const toks = (s) => new Set(String(s || '').toLowerCase().match(/[a-z]{3,}/g) || []);
const STOP = new Set(['the', 'and', 'game', 'games', 'puzzle', 'with', 'for', 'tap', 'mobile', 'casual', 'hybrid', 'your', 'you', 'this', 'that', 'from', 'are', 'not']);
function keywordComparables(text, games, n = 5) {
  const t = [...toks(text)].filter((w) => !STOP.has(w));
  return games.map((g) => {
    const gt = toks(`${g.name} ${(g.genres || []).join(' ')} ${g.reason || ''}`);
    const s = t.filter((w) => gt.has(w)).length + ((g.overall_score ?? g.overall) || 0) / 100;
    return { g, s };
  }).sort((a, b) => b.s - a.s).slice(0, n).map((x) => ({ game: x.g, similarity: 1, why: 'keyword match' }));
}

const SYSTEM = 'You are Pintu, rating a playable HTML5 prototype of a hybrid-casual mobile game. Judge only what the screenshots, the runtime note and the concept show. A script applies Pintu v2 weights, borrow rules and caps, so return the judged numbers exactly as asked. Be harsh on clones and on games that do not actually look playable.';

function buildPrompt({ combo, concept, runtime, imageRefs, cat, rub }) {
  const mechs = (combo.mechanics || []).map((m) => `${m.name}: ${m.desc}`).join('\n- ');
  return `# Rate this built HTML5 game with Pintu scoring v2

## Rubric (Pintu's SCORING_V2.md)
${rub.scoring}

## How to rate a new idea or build (IDEA_RATING.md)
${rub.idea}

## Archetypes (starting point, then adjust to what you see)
${rub.arche}

## The combination that was built
Base game: ${combo.game.name} (${combo.game.category}, Pintu overall ${combo.game.overall_score})
Theme: ${combo.theme?.name || ''} — ${combo.theme?.description || ''}
Mechanics merged:
- ${mechs}

## Concept the build was meant to implement
${JSON.stringify({
  title: concept.title, tagline: concept.tagline, hook: concept.hook,
  core_loop: concept.core_loop, mechanics_merge: concept.mechanics_merge,
  controls: concept.controls, win_lose: concept.win_lose, monetization: concept.monetization,
}, null, 1)}

## What headless Chrome saw
${runtime}

${imageRefs ? `### Screenshots. OPEN AND LOOK AT EVERY ONE before scoring:\n${imageRefs}` : '### Screenshots\nNone.'}

## Pintu's catalogue (${cat.length} games; id | name | category | genres | input | overall | momentum, staying, size | reason)
${catalogueLines(cat)}

## Judge
1. Deconstruct the game you actually see.
2. Pick 3-5 comparables FROM THE CATALOGUE (exact ids). similarity 3 = near-identical, 2 = same sub-genre, 1 = loose. The script borrows momentum, staying and size as their weighted median minus 1.
3. Clone-wave stage A3 (1-10) and saturated=true when this combination has 200+ clones a year.
4. Hook clarity + retry urge (1-10). Input code and score inside Anurag's band. Drag-to-merge is drag_merge, never tap_swipe.
5. Monetisation fit, theme & live-ops, feasibility & twist (each 1-10).
6. Mashup: applies=true because this build merges 2+ mechanics. Five checks, each 0-2, with a one-line reason. A match-3 with no real twist should score the checks low.
7. Also give four plain reads from 0 to 10, separate from the pillars: fun (would you play another round), novelty (genuine twist, not a reskin), clarity (readable in 3 seconds), market_fit (belongs next to the comparables).

Reply with ONLY this JSON:
{"game_name":"","one_line":"one sentence: what it is and the single biggest reason for the score","evidence_seen":"",
"deconstruct":{"core_mechanic":"","extra_mechanics":[],"meta":"","theme":"","monetisation":"","genre_tags":[]},
"archetype":"",
"comparables":[{"id":"exact catalogue id","similarity":3,"why":""}],
"wave":{"score":0,"saturated":false,"reason":""},
"hook":{"clarity":0,"reason":""},
"input":{"code":"tap_simple|tap_complex|drag|swipe|tap_double|tap_double_optional|drag_merge|tap_swipe|multi","score":0,"reason":""},
"monetisation":{"score":0,"reason":""},
"theme":{"score":0,"reason":""},
"feasibility":{"score":0,"reason":""},
"mashup":{"applies":true,"mechanics":[],"checks":[0,0,0,0,0],"check_reasons":["","","","",""]},
"reads":{"fun":0,"novelty":0,"clarity":0,"market_fit":0},
"kpis":{"d1":null,"d7":null,"cpi_usd":null},
"strengths":[""],"weaknesses":[""],
"summary":"3-5 sentences under Pintu v2"}`;
}

const r1 = (n) => Math.round(Number(n) * 10) / 10;
const clamp10 = (n, d = 5) => {
  const x = Number(n);
  return Number.isFinite(x) ? Math.max(0, Math.min(10, x)) : d;
};

// Demo-mode profile. Top-of-genre shelf games (>= 7.6, not pure match-3) produce a judgement
// that clears 7 after Pintu's math. Everything else lands under the cap so a mock night
// shows both keeps and discards. This is not a real critique.
function mockProfile(combo) {
  if ((combo.game.overall_score || 0) >= 7.6 && !combo.pureMatch3) return 'strong';
  return 'weak';
}

function topComparables(cat, n = 4) {
  return [...cat].filter((g) => g.scores).sort((a, b) => (b.overall_score ?? b.overall ?? 0) - (a.overall_score ?? a.overall ?? 0)).slice(0, n);
}

function mockJudgement(combo, cat) {
  const profile = mockProfile(combo);
  const strong = profile === 'strong';
  const comps = (strong ? topComparables(cat, 4) : keywordComparables(`${combo.game.name} ${(combo.mechanics || []).map((m) => m.name).join(' ')}`, cat, 4).map((c) => c.game));
  const names = (combo.mechanics || []).map((m) => m.name);
  const j = {
    _profile: profile,
    game_name: combo.theme ? `${combo.theme.name}` : combo.game.name,
    one_line: strong
      ? 'A one-thumb mashup with a readable loop and a real twist on a genre that is still making hits.'
      : 'The loop is readable, but the mashup does not earn its complexity and the genre is crowded.',
    evidence_seen: 'Demo mode: the built-in template was played in headless Chrome. Numbers are a stand-in, not a model judgement.',
    deconstruct: {
      core_mechanic: names[0] || 'puzzle',
      extra_mechanics: names.slice(1),
      meta: 'levels',
      theme: combo.theme?.name || '',
      monetisation: 'rewarded ads and a season pass',
      genre_tags: ['hybrid-casual', 'puzzle'],
    },
    archetype: 'sort_tap',
    comparables: comps.filter(Boolean).map((g) => ({ id: g.id, similarity: strong ? 3 : 2, why: strong ? 'same hybrid-casual lane' : 'loose keyword match' })),
    wave: strong
      ? { score: 7, saturated: false, reason: 'The base game is a distinctive hit and the twist is not a saturated clone wave.' }
      : { score: 3, saturated: true, reason: 'Demo: this pairing sits in a crowded wave.' },
    hook: strong
      ? { clarity: 8, reason: 'Goal and first move read immediately.' }
      : { clarity: 5, reason: 'You can tell it is a puzzle, not why this mashup is different.' },
    input: { code: 'tap_simple', score: 10, reason: 'One-thumb tap.' },
    monetisation: { score: strong ? 8 : 4, reason: strong ? 'Rewarded continue fits the loop.' : 'Monetisation is generic.' },
    theme: { score: strong ? 8 : 4, reason: strong ? 'Theme gives the pieces a reason to exist.' : 'Theme is a skin.' },
    feasibility: { score: strong ? 8 : 4, reason: strong ? 'Small-team scope with a visible twist over the base game.' : 'Little twist over a crowded base.' },
    mashup: {
      applies: names.length >= 2,
      mechanics: names,
      checks: strong ? [2, 2, 2, 2, 2] : [1, 1, 1, 1, 0],
      check_reasons: strong
        ? ['Core carries, the extra mechanic supports it', 'Same tap family', 'Same audience', 'A clear changes the next move', 'Hook reads in one glance']
        : ['Support mechanic is muddy', 'Gestures only barely agree', 'Audience is vague', 'Progress does not cross over', 'Hook does not read in 3 seconds'],
    },
    reads: strong ? { fun: 8, novelty: 8, clarity: 8, market_fit: 7 } : { fun: 5, novelty: 4, clarity: 6, market_fit: 5 },
    kpis: {},
    strengths: [strong ? 'Clear first session' : 'Runs without crashing'],
    weaknesses: [strong ? 'Still a prototype loop' : 'Not enough twist for the shelf it came from'],
    summary: strong
      ? 'Demo-mode stand-in. The shelf game is a distinctive high scorer and the mashup keeps a single gesture, so Pintu\'s math clears the keep bar.'
      : 'Demo-mode stand-in. The pairing is too close to a crowded reskin, so the mashup cap and a weak clone-wave score keep it under the bar.',
  };
  return j;
}

function readsOf(j, sc) {
  const pillar = (k) => sc.pillars.find((p) => p.key === k)?.score;
  const r = j.reads || {};
  return {
    fun: r1(clamp10(r.fun, pillar('hook') ?? 5)),
    novelty: r1(clamp10(r.novelty, pillar('feasibility') ?? 5)),
    clarity: r1(clamp10(r.clarity, sc.hook_clarity ?? 5)),
    market_fit: r1(clamp10(r.market_fit, ((pillar('momentum') ?? 5) + (pillar('size') ?? 5)) / 2)),
  };
}

function applyJudgement(j, cat, evidence = {}) {
  const byId = new Map(cat.map((g) => [g.id, g]));
  let comps = (Array.isArray(j.comparables) ? j.comparables : []).map((c) => ({
    game: byId.get(c.id) || cat.find((g) => g.name && g.name.toLowerCase() === String(c.name || c.id || '').toLowerCase()),
    similarity: c.similarity,
    why: c.why,
  })).filter((c) => c.game && c.game.scores);
  comps = comps.filter((c, i) => comps.findIndex((x) => x.game.id === c.game.id) === i).slice(0, 5);
  if (comps.length < 3) {
    const extra = keywordComparables(`${j.game_name || ''} ${j.deconstruct?.core_mechanic || ''} ${(j.deconstruct?.extra_mechanics || []).join(' ')}`, cat, 6)
      .filter((x) => x.game && x.game.scores && !comps.some((c) => c.game.id === x.game.id));
    comps.push(...extra.slice(0, 3 - comps.length));
  }
  const sc = S.scoreIdea(j, comps, { hasBuild: true, hasVideo: false, kpis: j.kpis || evidence.kpis || {} });
  return { score: sc, reads: readsOf(j, sc), comps, judgement: j };
}

async function judgeGame(ai, { combo, concept, runtime, shots }) {
  const catInfo = v2Catalogue();
  const cat = catInfo.games || [];
  if (!cat.length) throw Object.assign(new Error('Pintu catalogue is empty, cannot score'), { infra: true });
  let j;
  if (ai.ctx.mock) j = mockJudgement(combo, cat);
  else {
    const sharp = require('sharp');
    const files = [];
    const images = [];
    let imageRefs = '';
    const use = (shots || []).slice(0, 4);
    for (let i = 0; i < use.length; i++) {
      const buf = await sharp(use[i]).resize({ width: 720, height: 900, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 76 }).toBuffer();
      const name = `visuals/${String(i + 1).padStart(2, '0')}.jpg`;
      files.push({ name, data: buf });
      if (images.length < 4) images.push({ mime: 'image/jpeg', data: buf.toString('base64') });
      imageRefs += `- {{WS}}/${name}\n`;
    }
    const prompt = buildPrompt({ combo, concept, runtime, imageRefs, cat, rub: rubricBundle() });
    const ask = (extra = '') => ai.text({
      system: SYSTEM,
      prompt: prompt + extra,
      images,
      files,
      json: true,
      timeoutMs: (Number(process.env.RATE_TIMEOUT_MIN || 0) || 8) * 60000,
    });
    try { j = await ask(); } catch (e) {
      if (e.status && e.status < 500 && e.status !== 502) throw e;
      j = await ask('\n\nIMPORTANT: reply with the JSON object only.');
    }
  }
  const applied = applyJudgement(j, cat, {});
  return {
    ...applied,
    catalogue: catInfo.source,
    verdict: String(j.one_line || j.summary || '').replace(/\s+/g, ' ').trim(),
    summary: String(j.summary || '').trim(),
  };
}

module.exports = { judgeGame, mockJudgement, applyJudgement, mockProfile, v2Catalogue };
