// Refresh Pintu's v2 rubric + v2 scores snapshot used by "Rate My Game".
// Usage: node scripts/update-rubric.js [/path/to/pintu_shared_dir]   (default /workspace/shared on Golu's box)
// Copies SCORING_V2.md, IDEA_RATING.md, archetypes (from judgements_v2.json) into data/rubric/ and writes
// data/rubric/pintu_v2_scores.json (compact per-game pillar scores used for comparables).
const fs = require('fs');
const path = require('path');
const src = process.argv[2] || process.env.PINTU_SHARED_DIR || '/workspace/shared';
const out = path.join(__dirname, '..', 'data', 'rubric');
fs.mkdirSync(out, { recursive: true });
const rub = path.join(src, 'pintu_rubric');
for (const f of ['SCORING_V2.md', 'IDEA_RATING.md']) fs.copyFileSync(path.join(rub, f), path.join(out, f));
const J = JSON.parse(fs.readFileSync(path.join(rub, 'judgements_v2.json'), 'utf8'));
fs.writeFileSync(path.join(out, 'archetypes.json'), JSON.stringify({ version: J.version, archetypes: J.archetypes }, null, 1));
const R = JSON.parse(fs.readFileSync(path.join(src, 'pintu_ratings.json'), 'utf8'));
const games = R.games.filter((g) => g.scores && g.scores.momentum != null).map((g) => ({
  id: g.id, name: g.name, category: g.category, platform: g.platform, genres: g.genres, store_url: g.store_url,
  overall: g.overall_score, scores: g.scores, input_type: g.input_type, input_score: g.input_score, mashup_mechanics: g.mashup_mechanics,
  cap: g.cap_applied, confidence: g.confidence, reason: g.reason, theme_ideas: g.theme_ideas, released: g.released,
}));
fs.writeFileSync(path.join(out, 'pintu_v2_scores.json'), JSON.stringify({ updated_at: R.updated_at, rating_scale: R.rating_scale, count: games.length, games }));
console.log(`Rubric v2 copied to ${out}; ${games.length} games with v2 pillar scores (Pintu updated ${R.updated_at}).`);
