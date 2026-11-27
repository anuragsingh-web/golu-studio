// Pintu scoring v2 (18 Nov 2026), ported from Pintu's score_v2.py for "Rate My Game".
// Source of truth: data/rubric/SCORING_V2.md + IDEA_RATING.md (copied from Pintu's /workspace/shared/pintu_rubric).
// The AI only judges; every weight, band, borrow rule and cap is applied here in code.
const RUBRIC_VERSION = 'Pintu v2 (18 Nov 2026)';
const W = { momentum: 25, staying: 10, size: 15, hook: 20, monetisation: 10, theme: 10, feasibility: 10 };
const INPUT_BAND = { tap_simple: [10, 10], tap_complex: [7, 8], drag: [7, 8], swipe: [7, 8], tap_double: [5, 6], tap_double_optional: [7, 7], drag_merge: [7, 8], tap_swipe: [2, 3], multi: [2, 3] };
const INPUT_DEFAULT = { tap_simple: 10, tap_complex: 7.5, drag: 7.5, swipe: 7.5, tap_double: 5.5, tap_double_optional: 7, drag_merge: 7.5, tap_swipe: 2.5, multi: 2.5 };
const INPUT_LABEL = { tap_simple: 'Tap only (simple)', tap_complex: 'Tap only (complex)', drag: 'Drag only', swipe: 'Swipe only', tap_double: 'Tap + double tap', tap_double_optional: 'Tap + optional double tap', drag_merge: 'Drag-to-merge (tap + drag)', tap_swipe: 'Tap + swipe (distinct core gestures)', multi: '3+ distinct input types' };
const PILLARS = [
  { key: 'momentum', label: 'Market momentum' }, { key: 'staying', label: 'Staying power' }, { key: 'size', label: 'Market size & proof' },
  { key: 'hook', label: 'Hook & core loop' }, { key: 'monetisation', label: 'Monetisation fit' }, { key: 'theme', label: 'Theme & live-ops' },
  { key: 'feasibility', label: 'Feasibility & twist' }, { key: 'mashup', label: 'Mashup compatibility' },
];
const MASHUP_CHECKS = ['Clear core + support mechanic', 'Same input gesture family', 'Same audience', 'Progress in one changes the other', 'Combined hook reads in 3 s'];

const clamp = (x, lo = 1, hi = 10) => Math.max(lo, Math.min(hi, Number.isFinite(+x) ? +x : lo));
const r1 = (x) => Math.round(x * 10) / 10;
const num = (x, d) => (Number.isFinite(+x) && x !== null && x !== '' ? +x : d);

function weightedMedian(items) { // [{v, w}]
  const a = items.filter((i) => Number.isFinite(i.v)).sort((x, y) => x.v - y.v);
  if (!a.length) return null;
  const tot = a.reduce((s, i) => s + i.w, 0); let acc = 0;
  for (const i of a) { acc += i.w; if (acc >= tot / 2 - 1e-9) return i.v; }
  return a[a.length - 1].v;
}

// j = AI judgement (see lib/rate.js prompt), comps = [{ game (v2 row), similarity 1-3 }], evidence = { hasBuild, hasVideo, kpis }
function scoreIdea(j, comps, evidence = {}) {
  const parts = {}; const reasons = {}; const notes = [];
  const used = comps.filter((c) => c.game && c.game.scores);
  const names = used.map((c) => `${c.game.name} (${c.game.scores.momentum}/${c.game.scores.staying}/${c.game.scores.size})`).join(', ');
  const borrow = (k) => { const m = weightedMedian(used.map((c) => ({ v: +c.game.scores[k], w: clamp(c.similarity || 2, 1, 3) }))); return m == null ? null : clamp(m - 1); };
  const bm = borrow('momentum'), bs = borrow('staying'), bz = borrow('size');
  // A3 clone-wave stage for this combination (judged); 200+ clones/yr (saturated) caps A3 at 5.
  let a3 = clamp(num(j.wave?.score, 5)); const saturated = !!j.wave?.saturated; if (saturated) a3 = Math.min(a3, 5);
  // Momentum: comparables' weighted median - 1 stands in for the market signals (A1+A2, weight 17/25), blended with the
  // combination's own clone-wave stage A3 (weight 8/25), the same split score_v2.py uses for web games.
  parts.momentum = r1(clamp(bm == null ? (4 * 17 + 8 * a3) / 25 : (17 * bm + 8 * a3) / 25));
  reasons.momentum = `${bm == null ? 'No comparables found, baseline 4' : `Comparables' weighted median momentum minus 1 = ${r1(bm)}`} (17/25) blended with clone-wave stage A3 ${a3}${saturated ? ' (saturated, capped at 5)' : ''} (8/25). ${j.wave?.reason || ''}`.trim();
  parts.staying = r1(bs == null ? 5 : bs);
  reasons.staying = bs == null ? 'No comparables found, neutral 5' : `Borrowed from comparables: weighted median staying power minus 1 = ${r1(bs)}.`;
  parts.size = r1(bz == null ? 4 : bz);
  reasons.size = bz == null ? 'No comparables found, baseline 4' : `Borrowed from comparables: weighted median market size minus 1 = ${r1(bz)}.`;
  if (used.length) notes.push(`Comparables (momentum/staying/size): ${names}`);
  // Hook: 50% clarity + retry urge, 50% input simplicity (Anurag's input rules, score clamped to the input band).
  let input = String(j.input?.code || 'tap_simple').toLowerCase(); if (!INPUT_BAND[input]) input = 'tap_complex';
  const [lo, hi] = INPUT_BAND[input]; const inputScore = Math.min(hi, Math.max(lo, num(j.input?.score, INPUT_DEFAULT[input])));
  const hookClarity = clamp(num(j.hook?.clarity, 5));
  parts.hook = r1(0.5 * hookClarity + 0.5 * inputScore);
  reasons.hook = `Hook clarity + retry urge ${hookClarity}/10: ${j.hook?.reason || ''} Input: ${INPUT_LABEL[input]} = ${inputScore}/10${j.input?.reason ? ` (${j.input.reason})` : ''}.`;
  parts.monetisation = clamp(num(j.monetisation?.score, 5)); reasons.monetisation = j.monetisation?.reason || '';
  parts.theme = clamp(num(j.theme?.score, 5)); reasons.theme = j.theme?.reason || '';
  parts.feasibility = clamp(num(j.feasibility?.score, 5)); reasons.feasibility = j.feasibility?.reason || '';
  // Mashup only when 2+ mechanics: 5 checks x 0-2, other weights x0.9.
  const mechs = (j.mashup?.mechanics || []).filter(Boolean);
  let mashup = null, checks = null; let ws = { ...W };
  if (j.mashup?.applies && mechs.length >= 2) {
    checks = [0, 1, 2, 3, 4].map((i) => Math.max(0, Math.min(2, Math.round(num((j.mashup.checks || [])[i], 1)))));
    mashup = checks.reduce((a, b) => a + b, 0);
    ws = Object.fromEntries(Object.entries(W).map(([k, v]) => [k, v * 0.9])); ws.mashup = 10; parts.mashup = Math.max(mashup, 1);
    reasons.mashup = `${mechs.join(' + ')}: ${checks.map((c, i) => `${MASHUP_CHECKS[i]} ${c}/2${j.mashup.check_reasons?.[i] ? ` (${j.mashup.check_reasons[i]})` : ''}`).join('; ')}.`;
  }
  const totW = Object.values(ws).reduce((a, b) => a + b, 0);
  const ov = Object.keys(ws).reduce((s, k) => s + parts[k] * ws[k], 0) / totW;
  const caps = [];
  if (input === 'tap_swipe' || input === 'multi') caps.push([5.0, 'distinct tap AND swipe core gestures, or 3+ input types, caps Overall at 5.0 (drag-to-merge is not capped)']);
  if (mashup !== null && mashup <= 4) caps.push([6.0, 'mashup score 4 or below caps Overall at 6.0']);
  caps.sort((a, b) => a[0] - b[0]);
  const cap = caps[0] || null;
  const overall = r1(cap ? Math.min(ov, cap[0]) : ov);
  const k = evidence.kpis || {};
  const hasKpi = [k.d1, k.d7, k.cpi_usd].some((x) => x !== null && x !== undefined && x !== '' && Number.isFinite(+x));
  const confidence = hasKpi ? 'high' : evidence.hasBuild || evidence.hasVideo ? 'medium' : 'low';
  const pillars = PILLARS.filter((p) => p.key !== 'mashup' || mashup !== null).map((p) => ({ ...p, score: parts[p.key], weight: r1(ws[p.key]), reason: reasons[p.key] }));
  return {
    rubric_version: RUBRIC_VERSION, overall, overall_uncapped: r1(ov), cap: cap && ov > cap[0] ? cap[1] : null, cap_rule: cap ? cap[1] : null,
    confidence, pillars, input: { code: input, label: INPUT_LABEL[input], score: inputScore }, hook_clarity: hookClarity,
    a3, saturated, mashup: mashup === null ? null : { score: mashup, checks, mechanics: mechs }, notes,
    formula: `Overall = Σ(score × weight) / Σ(weight) = ${r1(ov)}${cap ? `; cap ${cap[0]} (${cap[1]})` : ''}. Weights: ${pillars.map((p) => `${p.label} ${p.weight}`).join(', ')}.`,
  };
}

module.exports = { RUBRIC_VERSION, W, INPUT_BAND, INPUT_DEFAULT, INPUT_LABEL, PILLARS, MASHUP_CHECKS, scoreIdea, weightedMedian };
