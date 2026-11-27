// Pulls Pintu's latest ratings from the shared Google Sheet into data/pintu_ratings.json.
// On failure the cached local file is left untouched (the server re-reads it on every request).
'use strict';
const fs = require('fs');
const path = require('path');
const { DATA_FILE } = require('./data');

const DEFAULT_SHEET_ID = '1jToJ8Jt5pfbEwCM_rJBu2e60o6HUOdyEiTweK1T9sAY';
const DEFAULT_GAMES_GID = '120944992';
const DEFAULT_META_GID = '1093157980';
const DEFAULT_SHEET_URL = `https://docs.google.com/spreadsheets/d/${DEFAULT_SHEET_ID}/export?format=csv&gid=${DEFAULT_GAMES_GID}`;
const INTERVAL_MS = Number(process.env.RATINGS_SYNC_INTERVAL_MS || 30 * 60 * 1000);

const state = {
  lastAttemptAt: null,
  lastSuccessAt: null,
  lastError: null,
  sourceUpdatedAt: null,
  gameCount: null,
};

function csvExportUrl(spreadsheetId, gid) {
  return `https://docs.google.com/spreadsheets/d/${spreadsheetId}/export?format=csv&gid=${gid}`;
}

function resolveUrls() {
  const raw = process.env.RATINGS_SHEET_URL;
  const sheetUrl = (raw === undefined || raw === '') ? DEFAULT_SHEET_URL : String(raw).trim();
  if (!sheetUrl || sheetUrl === '0' || /^(off|false|disabled)$/i.test(sheetUrl)) {
    return { enabled: false, gamesUrl: null, metaUrl: null };
  }
  const idMatch = sheetUrl.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  const gidMatch = sheetUrl.match(/[?&]gid=(\d+)/);
  let gamesUrl = sheetUrl;
  let metaUrl = (process.env.RATINGS_SHEET_META_URL || '').trim() || null;
  if (idMatch && !/\/export\?|\/gviz\/tq/.test(sheetUrl)) {
    gamesUrl = csvExportUrl(idMatch[1], gidMatch ? gidMatch[1] : DEFAULT_GAMES_GID);
  }
  if (!metaUrl && idMatch) metaUrl = csvExportUrl(idMatch[1], DEFAULT_META_GID);
  return { enabled: true, gamesUrl, metaUrl };
}

function parseCsv(text) {
  if (!text) throw new Error('Empty CSV');
  if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
  const start = text.trimStart();
  if (/^<!DOCTYPE|^<html/i.test(start)) {
    throw new Error('Sheet is not publicly readable (got an HTML page). In Google Sheets: Share → General access → Anyone with the link → Viewer.');
  }
  const rows = [];
  let row = [];
  let cell = '';
  let i = 0;
  let inQuotes = false;
  while (i < text.length) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { cell += '"'; i += 2; continue; }
        inQuotes = false;
        i += 1;
        continue;
      }
      cell += c;
      i += 1;
      continue;
    }
    if (c === '"') { inQuotes = true; i += 1; continue; }
    if (c === ',') { row.push(cell); cell = ''; i += 1; continue; }
    if (c === '\r') { i += 1; continue; }
    if (c === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; i += 1; continue; }
    cell += c;
    i += 1;
  }
  if (inQuotes) throw new Error('Malformed CSV (unterminated quote)');
  if (cell.length || row.length) { row.push(cell); rows.push(row); }
  if (rows.length && rows[rows.length - 1].every((v) => v === '')) rows.pop();
  return rows;
}

function rowsToObjects(rows) {
  if (!rows.length) return [];
  const header = rows[0].map((h) => String(h || '').trim().toLowerCase());
  return rows.slice(1).filter((r) => r.some((c) => String(c).trim() !== '')).map((r) => {
    const o = {};
    header.forEach((h, i) => { o[h] = r[i] == null ? '' : r[i]; });
    return o;
  });
}

async function fetchText(url, timeoutMs = 20000) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: ctl.signal,
      redirect: 'follow',
      headers: { 'user-agent': 'GoluStudio/1.0 ratings-sync', accept: 'text/csv,text/plain,*/*' },
    });
    const body = await res.text();
    if (!res.ok) {
      if (res.status === 401 || res.status === 403) {
        throw new Error(`Sheet is not publicly readable (HTTP ${res.status}). In Google Sheets: Share → General access → Anyone with the link → Viewer.`);
      }
      throw new Error(`HTTP ${res.status} fetching ratings sheet`);
    }
    return body;
  } finally {
    clearTimeout(t);
  }
}

function parseMeta(rows) {
  const meta = {};
  for (const r of rowsToObjects(rows)) {
    const k = (r.key || r.name || '').trim();
    if (k) meta[k] = r.value;
  }
  if (meta.categories != null && meta.categories !== '') {
    try { meta.categories = JSON.parse(meta.categories); } catch { /* leave as string */ }
    if (!Array.isArray(meta.categories)) {
      meta.categories = String(meta.categories).split(',').map((s) => s.trim()).filter(Boolean);
    }
  }
  return meta;
}

function parseGames(rows) {
  const objs = rowsToObjects(rows);
  const games = [];
  const errors = [];
  for (const r of objs) {
    const raw = r.json || r.data || r.game || '';
    if (!String(raw).trim()) { errors.push(`empty json for id ${r.id || '?'}`); continue; }
    try {
      const g = JSON.parse(raw);
      if (!g || typeof g !== 'object' || !g.id) throw new Error('missing id');
      games.push(g);
    } catch (e) {
      errors.push(`${r.id || '?'}: ${e.message}`);
    }
  }
  return { games, errors };
}

function writeAtomic(file, obj) {
  const dir = path.dirname(file);
  fs.mkdirSync(dir, { recursive: true });
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(obj, null, 2));
  if (fs.existsSync(file)) {
    try { fs.copyFileSync(file, file.replace(/\.json$/, '.prev.json')); } catch { /* ignore */ }
  }
  fs.renameSync(tmp, file);
}

let inflight = null;

async function syncOnce({ quiet = false } = {}) {
  const urls = resolveUrls();
  if (!urls.enabled) return { skipped: true, reason: 'disabled' };
  if (inflight) return inflight;
  inflight = (async () => {
    state.lastAttemptAt = new Date().toISOString();
    try {
      const { games, errors } = parseGames(parseCsv(await fetchText(urls.gamesUrl)));
      if (errors.length) {
        if (errors.length > Math.max(2, games.length * 0.05)) {
          throw new Error(`Too many unreadable game rows (${errors.length}); first: ${errors[0]}`);
        }
        if (!quiet) console.warn(`[ratings-sync] skipped ${errors.length} bad row(s): ${errors.slice(0, 3).join('; ')}`);
      }
      if (!games.length) throw new Error('Sheet had no parseable games');

      let meta = {};
      if (urls.metaUrl) {
        try { meta = parseMeta(parseCsv(await fetchText(urls.metaUrl))); }
        catch (e) { if (!quiet) console.warn(`[ratings-sync] meta tab skipped: ${e.message}`); }
      }

      const payload = {
        updated_at: meta.updated_at || new Date().toISOString(),
        rating_scale: meta.rating_scale || '0-10, overall = average of performance and theme',
        categories: Array.isArray(meta.categories) ? meta.categories : [],
        page_url: meta.page_url || '',
        count: games.length,
        games,
      };
      writeAtomic(DATA_FILE, payload);

      let icon = null;
      try { icon = await require('../scripts/fetch-icons').fetchIcons({ quiet: true }); }
      catch (e) { if (!quiet) console.warn(`[ratings-sync] icon download failed: ${e.message}`); }

      state.lastSuccessAt = new Date().toISOString();
      state.lastError = null;
      state.sourceUpdatedAt = payload.updated_at;
      state.gameCount = games.length;
      if (!quiet) console.log(`[ratings-sync] wrote ${games.length} games (updated_at ${payload.updated_at})`);
      return { ok: true, gameCount: games.length, updated_at: payload.updated_at, icon };
    } catch (e) {
      const msg = e.name === 'AbortError' ? 'timed out fetching ratings sheet' : e.message;
      state.lastError = msg;
      if (!quiet) console.warn(`[ratings-sync] failed, keeping cached file: ${msg}`);
      return { ok: false, error: msg };
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}

function getStatus() {
  const urls = resolveUrls();
  return {
    enabled: urls.enabled,
    sheetUrl: urls.gamesUrl,
    lastAttemptAt: state.lastAttemptAt,
    lastSuccessAt: state.lastSuccessAt,
    lastError: state.lastError,
    sourceUpdatedAt: state.sourceUpdatedAt,
    gameCount: state.gameCount,
    intervalMs: INTERVAL_MS,
  };
}

function startPolling() {
  const urls = resolveUrls();
  if (!urls.enabled) {
    console.log('  Ratings sync: off');
    return null;
  }
  const run = () => syncOnce({ quiet: false }).catch(() => {});
  run();
  const t = setInterval(run, INTERVAL_MS);
  if (typeof t.unref === 'function') t.unref();
  return t;
}

module.exports = {
  DEFAULT_SHEET_URL,
  DEFAULT_SHEET_ID,
  DEFAULT_GAMES_GID,
  DEFAULT_META_GID,
  parseCsv,
  parseGames,
  parseMeta,
  resolveUrls,
  syncOnce,
  getStatus,
  startPolling,
};
