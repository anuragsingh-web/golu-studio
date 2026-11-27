#!/usr/bin/env node
// Downloads every game icon from data/pintu_ratings.json into data/icons/ (skips ones already cached).
// Usage: npm run icons   (also runs automatically in the background when the server starts)
const fs = require('fs');
const path = require('path');
const { readRatings, iconKey, ICON_DIR } = require('../lib/data');

async function fetchIcons({ quiet = false } = {}) {
  fs.mkdirSync(ICON_DIR, { recursive: true });
  const { games } = readRatings();
  let ok = 0, skip = 0, fail = 0;
  const queue = games.filter((g) => {
    if (g.icon_local) { skip++; return false; }
    return !!g.icon_remote;
  });
  async function worker() {
    while (queue.length) {
      const g = queue.shift();
      try {
        const ctl = new AbortController();
        const t = setTimeout(() => ctl.abort(), 15000);
        const res = await fetch(g.icon_remote, { signal: ctl.signal, headers: { 'user-agent': 'Mozilla/5.0 GoluStudio/1.0', accept: 'image/*' } });
        clearTimeout(t);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const buf = Buffer.from(await res.arrayBuffer());
        const ct = res.headers.get('content-type') || '';
        let ext = ct.includes('png') ? 'png' : ct.includes('webp') ? 'webp' : ct.includes('gif') ? 'gif' : 'jpg';
        let out = buf;
        try { // normalise to 256px PNG so every browser can show it
          const sharp = require('sharp');
          out = await sharp(buf, { animated: false }).resize(256, 256, { fit: 'cover' }).png().toBuffer();
          ext = 'png';
        } catch {}
        fs.writeFileSync(path.join(ICON_DIR, `${iconKey(g.id)}.${ext}`), out);
        ok++;
      } catch (e) {
        fail++;
        if (!quiet) console.warn(`  icon failed: ${g.name} (${e.message})`);
      }
    }
  }
  await Promise.all(Array.from({ length: 6 }, worker));
  if (!quiet || ok || fail) console.log(`[icons] downloaded ${ok}, cached ${skip}, failed ${fail} (failed ones fall back to remote URL)`);
  return { ok, skip, fail };
}

if (require.main === module) fetchIcons().catch((e) => { console.error(e); process.exit(1); });
module.exports = { fetchIcons };
