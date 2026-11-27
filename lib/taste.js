// Which shelf games and mechanic mashups the nightly autopilot is allowed to try.
// Owner's taste: unique games doing well inside a genre, not the giants; no pure casual;
// match-3 only when the combo adds a genuine twist.
const { LIBRARY, originalMechanic } = require('./mechanics');

const GIANT_RE = /\b(candy crush|royal match|gardenscapes|homescapes|township|coin master|subway surfers|temple run|toon blast|fishdom|merge mansion|travel town|wordscapes|clash of clans|clash royale|pok[eé]mon|roblox|minecraft|monopoly go|project makeover|lily'?s garden|8 ball pool|among us|royal kingdom|whiteout survival|homescapes)\b/i;

// Puzzle-ish genres. A game that is only "Casual" / "Arcade" with no puzzle mechanic is out.
const PUZZLE_GENRE = /puzzle|brain|skill|board|word|match|sort|trivia|strategy|logic|block|tile/i;
const CASUAL_GENRE = /^(casual|entertainment|arcade|hyper-?casual|action|racing|simulation|adventure|sports|idle)$/i;
const PURE_CASUAL = new Set(['idle', 'runner']);
// Adding only these to a match-3 base is a reskin, not a twist.
const MATCH3_ADJACENT = new Set(['match3', 'tile', 'bubble']);
const TWIST = new Set(['physics', 'screw', 'parking', 'draw', 'sorting', 'merge', 'pathfinding', 'hidden', 'word', 'logic', 'rhythm', 'td']);
// Idle and runner are pure casual, so they are never merged in.
const EXTRA_IDS = LIBRARY.map((m) => m.id).filter((id) => !PURE_CASUAL.has(id));

const COMPLEMENT = new Set([
  'merge+sorting', 'physics+sorting', 'parking+physics', 'screw+sorting', 'physics+tile',
  'logic+pathfinding', 'bubble+physics', 'draw+physics', 'logic+word', 'hidden+logic',
  'merge+parking', 'physics+screw', 'draw+sorting', 'pathfinding+sorting',
]);

function hash(s) {
  let h = 2166136261;
  for (const c of String(s)) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return h >>> 0;
}
const norm = (s) => String(s || '').toLowerCase().replace(/\s+/g, ' ').trim();
const mechKey = (ids) => (ids || []).filter((id) => id && id !== 'original').slice().sort().join('+');

function detected(game) {
  const text = `${game.name} ${(game.genres || []).join(' ')} ${(game.mashup_mechanics || []).join(' ')}`;
  return LIBRARY.filter((m) => m.re.test(text)).map((m) => m.id);
}

function isGiant(game) { return GIANT_RE.test(game.name || ''); }

function isPureCasual(game) {
  const mechs = detected(game);
  if (mechs.some((id) => !PURE_CASUAL.has(id))) return false;
  const genres = (game.genres || []).filter((g) => !/mobile|mouse|premium|flash|2d|3d|games for|perks|story|relax/i.test(g));
  if (mechs.some((id) => PURE_CASUAL.has(id)) && !genres.some((g) => PUZZLE_GENRE.test(g))) return true;
  if (!genres.length) return false;
  return genres.every((g) => CASUAL_GENRE.test(String(g).trim()));
}

function isPureMatch3(game) {
  const mechs = detected(game);
  const named = /match ?-?3|crush|candy|jewel|gem|royal match|matching/i.test(game.name || '');
  if (!mechs.includes('match3') && !named) return false;
  if ((game.mashup_mechanics || []).length >= 2) return false;
  const others = mechs.filter((id) => !MATCH3_ADJACENT.has(id) && !PURE_CASUAL.has(id));
  return others.length === 0;
}

// Doing well, and not a giant or a pure-casual title. Hybrid-casual is the lane;
// "Other games" has to clear a higher bar so chart giants don't sneak in on score alone.
function promising(game, { minHybrid = 6.4, minOther = 6.8 } = {}) {
  if (!game || game.overall_score == null) return false;
  if (isGiant(game) || isPureCasual(game)) return false;
  const hybrid = /hybrid/i.test(game.category || '');
  if (hybrid) return game.overall_score >= minHybrid;
  const puzzleMech = detected(game).some((id) => !PURE_CASUAL.has(id));
  return puzzleMech && game.overall_score >= minOther;
}

function allowedExtras(game, ids) {
  if (!ids.length || ids.length > 2) return false;
  if (ids.some((id) => PURE_CASUAL.has(id))) return false;
  const det = new Set(detected(game));
  // The base game's own loop is already in the merge. Extras have to be new.
  if (ids.some((id) => det.has(id))) return false;
  const baseIsMatch = det.has('match3') || isPureMatch3(game);
  if (baseIsMatch && !ids.some((id) => TWIST.has(id))) return false;
  if (baseIsMatch && ids.every((id) => MATCH3_ADJACENT.has(id))) return false;
  return true;
}

function strip(m) { return { id: m.id, name: m.name, desc: m.desc }; }

function timesTried(history, gameId, key) {
  return Object.values(history.combos || {}).filter((c) => c.gameId === gameId && c.mechKey === key).length;
}

function rankOf(game, ids, history, seed) {
  const primary = detected(game)[0] || 'puzzle';
  const same = Object.values(history.combos || {}).filter((c) => c.primary === primary).length;
  const jitter = (hash(`${seed}|${game.id}|${mechKey(ids)}`) % 1000) / 1000;
  let r = (game.overall_score || 0) * 10;
  r += /hybrid/i.test(game.category || '') ? 4 : 0;
  r += (game.mashup_mechanics || []).length ? 1.5 : 0;
  r += ids.length === 2 ? 1.2 : 0;
  if (COMPLEMENT.has(mechKey(ids))) r += 1.5;
  r -= same * 0.35;
  r -= isPureMatch3(game) ? 3 : 0;
  r += jitter;
  return r;
}

function diversify(sorted, limit) {
  const picked = [];
  const perBase = {};
  const perPrimary = {};
  const caps = [{ base: 2, primary: 3 }, { base: 3, primary: 5 }, { base: 99, primary: 99 }];
  const chosen = new Set();
  for (const cap of caps) {
    for (const c of sorted) {
      if (chosen.has(c)) continue;
      if ((perBase[c.game.id] || 0) >= cap.base) continue;
      if ((perPrimary[c.primary] || 0) >= cap.primary) continue;
      chosen.add(c);
      picked.push(c);
      perBase[c.game.id] = (perBase[c.game.id] || 0) + 1;
      perPrimary[c.primary] = (perPrimary[c.primary] || 0) + 1;
      if (picked.length >= limit) return picked;
    }
  }
  return picked;
}

// Ordered list of { game, mechanics, mechIds, mechKey, primary, rank, pureMatch3 }.
// `limit` should be higher than the night's count so exhausted themes have alternates.
function planCombos({ games, history = { combos: {} }, count = 20, seed = 'night', limit } = {}) {
  const want = limit || Math.max(count * 3, count + 8);
  const bases = (games || []).filter((g) => promising(g));
  const byId = new Map(LIBRARY.map((m) => [m.id, m]));
  const candidates = [];
  for (const game of bases) {
    const sets = [];
    for (const id of EXTRA_IDS) if (allowedExtras(game, [id])) sets.push([id]);
    for (let i = 0; i < EXTRA_IDS.length; i++) {
      for (let j = i + 1; j < EXTRA_IDS.length; j++) {
        const ids = [EXTRA_IDS[i], EXTRA_IDS[j]];
        if (allowedExtras(game, ids)) sets.push(ids);
      }
    }
    const rawOrig = originalMechanic(game);
    const orig = strip(rawOrig);
    if (rawOrig.detected && rawOrig.detected.length) orig.name = rawOrig.detected[0];
    const primary = detected(game)[0] || 'puzzle';
    const pure = isPureMatch3(game);
    for (const ids of sets) {
      const key = mechKey(ids);
      if (timesTried(history, game.id, key) >= 8) continue;
      const extras = ids.map((id) => strip(byId.get(id))).filter((m) => m && m.id);
      if (extras.length !== ids.length) continue;
      candidates.push({
        game,
        mechanics: [orig, ...extras],
        mechIds: ids.slice().sort(),
        mechKey: key,
        primary,
        pureMatch3: pure,
        rank: rankOf(game, ids, history, seed),
      });
    }
  }
  candidates.sort((a, b) => b.rank - a.rank);
  const picked = diversify(candidates, want);
  return { bases: bases.length, candidates: candidates.length, combos: picked };
}

function labelCombo(c, themeName) {
  const mechs = (c.mechanics || []).map((m) => m.name).join(' + ');
  return `${c.game.name}${themeName ? ` · ${themeName}` : ''} · ${mechs}`;
}

module.exports = {
  hash, norm, mechKey, detected, isGiant, isPureCasual, isPureMatch3, promising, allowedExtras,
  planCombos, labelCombo, GIANT_RE,
};
