#!/usr/bin/env node
// Replace data/pintu_ratings.json with a fresh copy, then cache any new icons.
// Usage: npm run update-data -- /path/to/pintu_ratings.json
//    or: npm run update-data -- https://example.com/pintu_ratings.json
const fs = require('fs');
const path = require('path');
const dest = path.join(__dirname, '..', 'data', 'pintu_ratings.json');
(async () => {
  const src = process.argv[2];
  if (!src) { console.error('Usage: npm run update-data -- <path-or-url-to-pintu_ratings.json>'); process.exit(1); }
  const text = /^https?:/.test(src) ? await (await fetch(src)).text() : fs.readFileSync(src, 'utf8');
  const j = JSON.parse(text);
  if (!Array.isArray(j.games)) throw new Error('Not a Pintu ratings file (missing games[])');
  if (fs.existsSync(dest)) fs.copyFileSync(dest, dest.replace(/\.json$/, '.prev.json'));
  fs.writeFileSync(dest, JSON.stringify(j, null, 2));
  console.log(`Updated ${dest}: ${j.games.length} games, updated_at ${j.updated_at}. (Previous copy saved as pintu_ratings.prev.json)`);
  await require('./fetch-icons').fetchIcons();
})().catch((e) => { console.error(e.message); process.exit(1); });
