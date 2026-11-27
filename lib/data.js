// Ratings data access. Re-reads data/pintu_ratings.json on every call so the file can be swapped live.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.join(__dirname, '..');
const DATA_FILE = process.env.RATINGS_FILE || path.join(ROOT, 'data', 'pintu_ratings.json');
const ICON_DIR = path.join(ROOT, 'data', 'icons');

// Pintu compresses URLs with 2-char prefixes (same table as Pintu's page).
const PFX = {
  '~A': 'https://is1-ssl.mzstatic.com/image/thumb/',
  '~P': 'https://play-lh.googleusercontent.com/',
  '~K': 'https://img.poki-cdn.com/cdn-cgi/image/quality=78,width=200,height=200,fit=cover,f=auto/',
  '~C': 'https://imgs.crazygames.com/',
  '~I': 'https://img.itch.zone/',
  '~S': 'https://apps.apple.com/us/app/',
  '~G': 'https://play.google.com/store/apps/details?id=',
};
const expandUrl = (s) => (s && s[0] === '~' ? (PFX[s.slice(0, 2)] || '') + s.slice(2) : s || '');

const iconKey = (id) => crypto.createHash('sha1').update(String(id)).digest('hex').slice(0, 16);
const safeKey = (id) => String(id).replace(/[^a-zA-Z0-9_-]+/g, '_').slice(0, 80);

function findCachedIcon(id) {
  const k = iconKey(id);
  for (const ext of ['png', 'jpg', 'webp', 'gif']) {
    if (fs.existsSync(path.join(ICON_DIR, `${k}.${ext}`))) return `/icons/${k}.${ext}`;
  }
  return null;
}

function readRatings() {
  const raw = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  const games = (raw.games || []).map((g) => ({
    ...g,
    icon_remote: expandUrl(g.icon_url),
    icon_local: findCachedIcon(g.id),
    store_url: expandUrl(g.store_url),
    store_urls: (g.store_urls || []).map(expandUrl),
    genres: g.genres || [],
  }));
  games.sort((a, b) => (b.overall_score ?? 0) - (a.overall_score ?? 0));
  games.forEach((g, i) => (g.rank = i + 1));
  return { meta: { updated_at: raw.updated_at, rating_scale: raw.rating_scale, categories: raw.categories || [], page_url: raw.page_url, count: games.length }, games };
}

function getGame(id) {
  return readRatings().games.find((g) => g.id === id) || null;
}

module.exports = { ROOT, DATA_FILE, ICON_DIR, expandUrl, iconKey, safeKey, readRatings, getGame };
