// Golu Studio frontend (vanilla JS, hash routing).
const $ = (s, el = document) => el.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const app = $('#app');

// ---------- settings / API ----------
const SKEY = 'golu.settings';
const settings = () => { try { return JSON.parse(localStorage.getItem(SKEY)) || {}; } catch { return {}; } };
function headers() {
  const s = settings(), h = { 'content-type': 'application/json' };
  if (s.provider) h['x-ai-provider'] = s.provider;
  if (s.anthropicKey) h['x-anthropic-key'] = s.anthropicKey;
  if (s.geminiKey) h['x-gemini-key'] = s.geminiKey;
  if (s.textModel) h['x-text-model'] = s.textModel;
  if (s.codeModel) h['x-code-model'] = s.codeModel;
  if (s.mock) h['x-golu-mock'] = '1';
  return h;
}
async function api(path, opts = {}) {
  const res = await fetch(path, { ...opts, headers: { ...headers(), ...(opts.headers || {}) }, body: opts.body ? JSON.stringify(opts.body) : undefined });
  const ct = res.headers.get('content-type') || '';
  const data = ct.includes('json') ? await res.json() : await res.text();
  if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);
  return data;
}
function toast(msg, bad = false) { const t = $('#toast'); t.textContent = msg; t.className = `toast show ${bad ? 'bad' : ''}`; clearTimeout(t._h); t._h = setTimeout(() => (t.className = 'toast'), 4200); }
async function pollJob(id, onUpdate) {
  for (;;) {
    const j = await api(`/api/jobs/${id}`);
    onUpdate(j);
    if (j.status !== 'running') return j;
    await new Promise((r) => setTimeout(r, 1200));
  }
}

let config = null;
async function loadConfig() {
  try {
    config = await api('/api/config');
    const chip = $('#providerChip');
    if (config.mock) { chip.textContent = '🧪 Demo mode (mock)'; chip.className = 'chip warn'; }
    else if (!config.ready) { chip.textContent = config.provider === 'cursor-agent' ? '⚠️ Cursor CLI: setup needed' : config.provider === 'claude-code' ? '⚠️ Claude Code: setup needed' : `⚠️ ${config.provider === 'gemini' ? 'Gemini' : 'Anthropic API'}: no key`; chip.className = 'chip warn'; }
    else { chip.textContent = `✨ ${config.provider === 'cursor-agent' ? 'Cursor' : config.provider === 'claude-code' ? 'Claude subscription' : config.provider === 'gemini' ? 'Gemini' : 'Anthropic API'} · ${config.models.text}${config.models.code !== config.models.text ? ` / H5: ${config.models.code}` : ''}`; chip.className = 'chip ok'; }
    $('#modelList').innerHTML = (config.models.textCandidates || []).map((m) => `<option value="${esc(m)}">`).join('');
  } catch (e) { $('#providerChip').textContent = 'server offline'; }
}

// settings dialog
$('#settingsBtn').onclick = () => {
  const s = settings();
  $('#sProvider').value = s.provider || 'cursor-agent'; $('#sAnthropic').value = s.anthropicKey || ''; $('#sGemini').value = s.geminiKey || '';
  $('#sText').value = s.textModel || ''; $('#sCode').value = s.codeModel || ''; $('#sMock').checked = !!s.mock;
  $('#sStatus').textContent = config ? `Server: provider ${config.providerLabel || config.provider}${config.provider === 'cursor-agent' ? `, Cursor CLI ${config.cursorAgent?.installed ? `${config.cursorAgent.version || 'installed'}, signed in: ${config.cursorAgent.loggedIn === null ? 'unknown' : config.cursorAgent.loggedIn ? 'yes' : 'no'}` : 'not found'}` : config.provider === 'claude-code' ? `, CLI ${config.claudeCode?.installed ? `${config.claudeCode.version || 'installed'}, signed in: ${config.claudeCode.loggedIn === null ? 'unknown' : config.claudeCode.loggedIn ? 'yes' : 'no'}` : 'not found'}` : `, key ${config.keyPresent ? `present (${config.keySource})` : 'missing'}`}, headless Chrome ${config.chrome}. Models: text ${config.models.text || '-'}, code ${config.models.code || '-'}${config.models.error ? ` (model list error: ${config.models.error})` : ''}` : '';
  $('#settings').showModal();
};
$('#sSave').onclick = () => {
  localStorage.setItem(SKEY, JSON.stringify({ provider: $('#sProvider').value, anthropicKey: $('#sAnthropic').value.trim(), geminiKey: $('#sGemini').value.trim(), textModel: $('#sText').value.trim(), codeModel: $('#sCode').value.trim(), mock: $('#sMock').checked }));
  toast('Settings saved'); loadConfig().then(route);
};

// ---------- data ----------
let ratings = null;
async function loadRatings() {
  ratings = await api('/api/games');
  const d = ratings.meta;
  let line = `Pintu ratings · ${d.count} games · updated ${fmtIST(d.updated_at)}`;
  try {
    const sync = await api('/api/sync-status');
    if (sync.lastSuccessAt) line += ` · Ratings synced ${fmtIST(sync.lastSuccessAt)}`;
  } catch { /* keep the ratings line even if sync status is unavailable */ }
  $('#dataInfo').textContent = line;
  return ratings;
}
function fmtIST(iso) { try { return new Date(iso).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }) + ' IST'; } catch { return iso; } }
const scoreCls = (s) => (s >= 7 ? 's-hi' : s >= 5 ? 's-mid' : 's-lo');
const iconImg = (g, cls = '', lazy = true) => `<img class="${cls}" ${lazy ? 'loading="lazy"' : ''} src="${esc(g.icon_local || g.icon || g.icon_remote)}" referrerpolicy="no-referrer" data-remote="${esc(g.icon_remote || '')}" onerror="if(this.dataset.remote&&this.src!==this.dataset.remote){this.src=this.dataset.remote}else{this.style.visibility='hidden'}" alt="">`;

function tile(g, i = 0) {
  return `<a class="tile" href="#/game/${encodeURIComponent(g.id)}" style="--d:${i}" title="${esc(g.name)}">
    <div class="tile-3d"><div class="tile-shadow"></div><div class="tile-face">${iconImg(g)}<div class="gloss"></div></div></div>
    <div class="badge ${scoreCls(g.overall_score)}">${Number(g.overall_score).toFixed(1)}</div>
    <div class="rank">#${g.rank}</div>
    <div class="tile-name">${esc(g.name)}</div><div class="tile-cat">${esc(g.category)}</div></a>`;
}
function bindTilt(root) {
  root.querySelectorAll('.tile').forEach((t) => {
    const inner = t.querySelector('.tile-3d');
    t.addEventListener('pointermove', (e) => {
      const r = inner.getBoundingClientRect(); const x = (e.clientX - r.left) / r.width - 0.5, y = (e.clientY - r.top) / r.height - 0.5;
      inner.style.setProperty('--ry', `${x * 34}deg`); inner.style.setProperty('--rx', `${-y * 30}deg`);
      inner.style.setProperty('--gx', `${(x + 0.5) * 100}%`); inner.style.setProperty('--gy', `${(y + 0.5) * 100}%`);
    });
    t.addEventListener('pointerleave', () => { inner.style.removeProperty('--rx'); inner.style.removeProperty('--ry'); });
  });
}

// ---------- provider setup card ----------
function setupCard() {
  if (!config || config.mock || config.ready && !(config.provider === 'claude-code' && config.claudeCode?.loggedIn === null) && !(config.provider === 'cursor-agent' && config.cursorAgent?.loggedIn === null)) return '';
  if (config.provider === 'cursor-agent') {
    const ca = config.cursorAgent || {};
    const ok = (b) => (b ? '✅' : b === false ? '⬜' : '❔');
    return `<div class="setup-card"><div class="setup-head"><div class="setup-ico">🖱️</div><div><h3>Use your Cursor subscription</h3><p class="muted">Golu runs on your Cursor plan through the Cursor CLI, using Claude models. You don't need an API key. Do this once in Terminal:</p></div></div>
      <ol class="setup-steps">
        <li class="${ca.installed ? 'done' : ''}">${ok(ca.installed)} <b>Install the Cursor CLI</b>: <code>curl https://cursor.com/install -fsS | bash</code>${ca.installed ? ` <span class="muted small">found ${esc(ca.version || '')} at ${esc(ca.path || '')}</span>` : ' <span class="muted small">(Golu also finds it in ~/.local/bin even if it isn\'t on your PATH)</span>'}</li>
        <li class="${ca.loggedIn ? 'done' : ''}">${ok(ca.loggedIn)} <b>Sign in</b>: <code>cursor-agent login</code> (or <code>agent login</code>), then finish the sign-in in your browser with your Cursor account.${ca.account ? ` <span class="muted small">signed in as ${esc(ca.account)}</span>` : ''}${ca.loggedIn === null && ca.installed ? ' <span class="muted small">(couldn\'t read sign-in status, so click Test)</span>' : ''}</li>
        <li>${ok(null)} <b>Check</b>: click <i>Re-check</i>, then <i>Test</i>. Golu sends a tiny prompt through the Cursor CLI and shows which Claude models it picked.</li>
      </ol>
      <div class="setup-actions"><button class="btn ghost" id="ccRecheck">🔄 Re-check</button><button class="btn primary" id="ccTest" data-p="cursor-agent" ${ca.installed ? '' : 'disabled'}>⚡ Test</button><button class="btn ghost" id="tryDemo">Try demo mode</button><button class="btn ghost" id="addKey">Use another provider</button></div>
      <div id="ccResult" class="muted small"></div></div>`;
  }
  if (config.provider === 'claude-code') {
    const cc = config.claudeCode || {};
    const ok = (b) => (b ? '✅' : b === false ? '⬜' : '❔');
    return `<div class="setup-card"><div class="setup-head"><div class="setup-ico">🔐</div><div><h3>Use your Claude subscription</h3><p class="muted">Golu runs on your Claude Pro/Max plan through the Claude Code CLI. You don't need an API key. Do this once:</p></div></div>
      <ol class="setup-steps">
        <li class="${cc.installed ? 'done' : ''}">${ok(cc.installed)} <b>Install Claude Code</b>: in a terminal run <code>npm install -g @anthropic-ai/claude-code</code>${cc.installed ? ` <span class="muted small">found ${esc(cc.version || '')} at ${esc(cc.path || '')}</span>` : ''}</li>
        <li class="${cc.loggedIn ? 'done' : ''}">${ok(cc.loggedIn)} <b>Sign in</b>: run <code>claude</code>, choose <i>Claude account with subscription</i>, and sign in with your Claude app account in the browser. Then type <code>/exit</code>.${cc.loggedIn === null && cc.installed ? ' <span class="muted small">(sign-in status unknown on this CLI version, so click Test)</span>' : ''}${cc.note ? `<br><span class="muted small">${esc(cc.note)}</span>` : ''}</li>
        <li>${ok(null)} <b>Check</b>: click <i>Re-check</i>, then <i>Test</i>. Golu sends a tiny prompt through Claude Code.</li>
      </ol>
      <div class="setup-actions"><button class="btn ghost" id="ccRecheck">🔄 Re-check</button><button class="btn primary" id="ccTest" data-p="claude-code" ${cc.installed ? '' : 'disabled'}>⚡ Test</button><button class="btn ghost" id="tryDemo">Try demo mode</button><button class="btn ghost" id="addKey">Use an API key instead</button></div>
      <div id="ccResult" class="muted small"></div></div>`;
  }
  return `<div class="err" style="display:flex;gap:12px;align-items:center;justify-content:space-between;flex-wrap:wrap">🔑 No ${config.provider === 'gemini' ? 'Gemini' : 'Anthropic'} API key yet. You can browse, but themes, mockups and H5 builds need one. <span><button class="btn primary" id="addKey" style="padding:8px 14px;font-size:13px">Add key</button> <button class="btn ghost" id="tryDemo" style="padding:8px 14px;font-size:13px">Try demo mode</button></span></div>`;
}
function bindSetupCard() {
  const r = $('#ccRecheck'); if (!r) return;
  r.onclick = async () => { r.disabled = true; try { config = await api('/api/config?fresh=1'); await loadConfig(); renderHome(); } finally { r.disabled = false; } };
  $('#ccTest').onclick = async () => {
    const b = $('#ccTest'), out = $('#ccResult'), prov = b.dataset.p; b.disabled = true; out.innerHTML = `Asking Claude through ${prov === 'cursor-agent' ? 'the Cursor CLI' : 'Claude Code'}… (first run can take ~10–30 s)`;
    try { const t = await api(`/api/${prov}/test`, { method: 'POST' }); out.innerHTML = t.ok ? `<span style="color:var(--good)">✅ Working. It replied "${esc(t.reply)}" in ${(t.ms / 1000).toFixed(1)} s.${t.models ? ` Models: text <b>${esc(t.models.text)}</b>, H5 code <b>${esc(t.models.code)}</b>${t.models.discovered ? ` (picked from ${t.models.discovered} models on your account)` : ''}.` : ''} You're all set.</span>` : `⚠️ Unexpected reply: ${esc(t.reply)}`; }
    catch (e) { out.innerHTML = `<span style="color:#ffc2cb">⚠️ ${esc(e.message)}</span>`; }
    finally { b.disabled = false; }
  };
}

// ---------- home ----------
const homeState = { cat: 'All', q: '' };
async function renderHome() {
  if (!ratings) await loadRatings(); else loadRatings().then(() => {}).catch(() => {});
  const cats = ['All', ...(ratings.meta.categories || [])];
  app.innerHTML = `
    <h1 class="page">The Shelf</h1><p class="page-sub">Games fetched by Chotu, rated by Pintu. Ranked by overall score (avg of performance & theme). Tap a game to start a spin-off.</p>
    <div class="toolbar"><div class="pills">${cats.map((c) => `<button class="pill ${c === homeState.cat ? 'on' : ''}" data-cat="${esc(c)}">${esc(c)}</button>`).join('')}</div>
    <label class="search">🔎<input id="q" placeholder="Search games, developers, genres…" value="${esc(homeState.q)}"></label></div>
    ${setupCard()}
    <div id="shelf"></div>`;
  app.querySelectorAll('.pill').forEach((b) => (b.onclick = () => { homeState.cat = b.dataset.cat; renderHome(); }));
  bindSetupCard();
  if ($('#addKey')) { $('#addKey').onclick = () => $('#settingsBtn').click(); $('#tryDemo').onclick = () => { localStorage.setItem(SKEY, JSON.stringify({ ...settings(), mock: true })); loadConfig().then(route); }; }
  const q = $('#q'); q.oninput = () => { homeState.q = q.value; drawShelf(); };
  drawShelf();
}
function drawShelf() {
  const q = homeState.q.toLowerCase();
  const list = ratings.games.filter((g) => (homeState.cat === 'All' || g.category === homeState.cat) && (!q || `${g.name} ${g.developer} ${(g.genres || []).join(' ')}`.toLowerCase().includes(q)));
  const shelf = $('#shelf');
  if (!list.length) { shelf.innerHTML = '<div class="empty">No games match.</div>'; return; }
  const top = list.slice(0, 3), rest = list.slice(3);
  const pod = (g, cls, label) => g ? `<div class="pod ${cls}">${cls === 'p1' ? '<div class="crown">👑</div>' : ''}${tile(g, 0)}<div class="pod-block">${label}</div></div>` : '<div></div>';
  shelf.innerHTML = `<div class="podium">${pod(top[1], 'p2', '2')}${pod(top[0], 'p1', '1')}${pod(top[2], 'p3', '3')}</div>
    ${rest.length ? `<div class="section-title">Ranks 4 – ${list.length}</div><div class="grid">${rest.map((g, i) => tile(g, i + 3)).join('')}</div>` : ''}`;
  bindTilt(shelf);
}

// ---------- detail ----------
const stKey = (id) => `golu.state.${id}`;
const loadSt = (id) => { try { return JSON.parse(sessionStorage.getItem(stKey(id))) || {}; } catch { return {}; } };
const saveSt = (id, s) => sessionStorage.setItem(stKey(id), JSON.stringify(s));

async function renderGame(id) {
  if (!ratings) await loadRatings();
  const g = ratings.games.find((x) => x.id === id);
  if (!g) { app.innerHTML = `<a class="back" href="#/">← Back</a><div class="err">Game not found: ${esc(id)} (the ratings file may have changed)</div>`; return; }
  const st = Object.assign({ themeId: null, mechs: ['original'], ideaId: null }, loadSt(id));
  window.scrollTo(0, 0);
  app.innerHTML = `
  <a class="back" href="#/">← Back to shelf</a>
  <section class="hero">
    <div>${tile(g)}</div>
    <div>
      <div class="meta-row"><span class="chip">#${g.rank} on shelf</span><span class="chip">${esc(g.category)}</span>${g.platform ? `<span class="chip">${esc(g.platform)}</span>` : ''}${g.released ? `<span class="chip">Released ${esc(g.released)}</span>` : ''}</div>
      <h1>${esc(g.name)}</h1><div class="muted">${esc(g.developer || '')} · ${(g.genres || []).map(esc).join(' · ')}</div>
      <div class="scores">${[['Overall', g.overall_score], ['Performance', g.performance_score], ['Theme', g.theme_score]].map(([k, v]) => `<div class="score-box"><div class="muted small">${k}</div><b>${v ?? '–'}</b><span class="muted small">/10</span><div class="bar"><i style="width:${(v || 0) * 10}%"></i></div></div>`).join('')}</div>
      <div class="facts">${g.key_metrics ? `📊 ${esc(g.key_metrics)}<br>` : ''}${g.chart_ranks ? `🏆 ${esc(g.chart_ranks)}<br>` : ''}${g.sensor_tower_note ? `📈 ${esc(g.sensor_tower_note)}<br>` : ''}${g.monetization ? `💰 ${esc(g.monetization)}<br>` : ''}${g.theme_ideas ? `🎨 Pintu theme ideas: ${esc(g.theme_ideas)}<br>` : ''}${(g.store_urls || []).map((u) => `<a href="${esc(u)}" target="_blank" rel="noopener" style="color:#8be9ff">${u.includes('apple') ? 'App Store' : u.includes('google') ? 'Google Play' : 'Play page'} ↗</a>`).join(' · ')}</div>
    </div>
  </section>
  <section class="step" id="stepTheme"><div class="step-head"><h2><span class="num">1</span>Pick a theme</h2><button class="btn ghost" id="moreThemes">✨ More themes</button></div><div id="themeNote" class="theme-note"></div><div id="themes" class="themes"><div class="muted">Loading themes…</div></div></section>
  <section class="step" id="stepMech"><div class="step-head"><h2><span class="num">2</span>Merge mechanics <span class="muted small" style="font-weight:500">select one or more</span></h2></div><div id="mechs" class="mechs"></div><div id="merge"></div></section>
  <section class="step" id="stepIdea"><div class="step-head"><h2><span class="num">3</span>Mockup idea</h2></div><div id="idea"><div class="muted">Pick a theme and mechanics, then tap <b>Generate Mockup Idea</b>.</div></div><div id="history"></div></section>
  <section class="step" id="stepH5" style="display:none"><div class="step-head"><h2><span class="num">4</span>Playable H5</h2></div><div id="h5"></div></section>
  <div class="actionbar"><div class="actionbar-inner"><div class="sel-summary" id="selSummary"></div><button class="btn primary" id="genBtn">🎨 Generate Mockup Idea</button></div></div>`;
  bindTilt(app);

  let themes = [], mechs = [];
  const save = () => saveSt(id, st);
  const theme = () => themes.find((t) => t.id === st.themeId);
  const selMechs = () => mechs.filter((m) => st.mechs.includes(m.id));
  const summary = () => {
    const t = theme(), m = selMechs();
    $('#selSummary').innerHTML = `<b>${esc(g.name)}</b> · Theme: <b>${t ? esc(t.name) : '—'}</b> · Mechanics: <b>${m.map((x) => esc(x.name)).join(' + ') || '—'}</b>`;
    $('#genBtn').disabled = !t || !m.length;
  };

  // themes
  const themeObserver = new IntersectionObserver((ents) => ents.forEach((e) => { if (e.isIntersecting) { themeObserver.unobserve(e.target); queuePreview(e.target); } }), { rootMargin: '200px' });
  let active = 0; const q = [];
  function queuePreview(el) { q.push(el); pump(); }
  function pump() {
    while (active < 2 && q.length) {
      const el = q.shift(); active++;
      fetch(`/api/games/${encodeURIComponent(id)}/themes/${el.dataset.tid}/preview`, { headers: headers() })
        .then(async (r) => { if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || `HTTP ${r.status}`); return r.blob(); })
        .then((b) => { el.innerHTML = `<img src="${URL.createObjectURL(b)}" alt="">`; })
        .catch((e) => { el.innerHTML = `<div class="shimmer" style="animation:none;padding:14px;text-align:center">⚠️ ${esc(e.message).slice(0, 140)}<br><button class="btn ghost" style="margin-top:8px;padding:6px 10px;font-size:12px">Retry</button></div>`; el.querySelector('button').onclick = (ev) => { ev.stopPropagation(); el.innerHTML = '<div class="shimmer">Drawing preview…</div>'; queuePreview(el); }; })
        .finally(() => { active--; pump(); });
    }
  }
  function drawThemes() {
    $('#themes').innerHTML = themes.map((t) => `<div class="card ${t.id === st.themeId ? 'on' : ''}" data-id="${t.id}">
      <div class="thumb" data-tid="${t.id}"><div class="shimmer">Drawing preview…</div></div>
      <span class="src">${t.source === 'pintu' ? 'Pintu' : 'AI'}</span><div class="check">${t.id === st.themeId ? '✓' : ''}</div>
      <div class="card-body"><h3>${esc(t.name)}</h3><p>${esc(t.description)}</p><div class="swatches">${(t.palette || []).map((c) => `<i style="background:${esc(c)}"></i>`).join('')}</div></div></div>`).join('');
    $('#themes').querySelectorAll('.card').forEach((c) => (c.onclick = () => { st.themeId = c.dataset.id; st.themeName = theme()?.name || null; staleNote = ''; syncThemeBtn(); save(); $('#themes').querySelectorAll('.card').forEach((x) => { x.classList.toggle('on', x === c); x.querySelector('.check').textContent = x === c ? '✓' : ''; }); summary(); drawMerge(); }));
    $('#themes').querySelectorAll('.thumb').forEach((el) => themeObserver.observe(el));
  }
  // Theme set <-> mechanic selection. themesMech = extra mechanics the shown themes were generated for.
  let themesMech = null, themesMechLabel = '', themesBusy = false, staleNote = '';
  const extraMechIds = () => st.mechs.filter((x) => x !== 'original').sort();
  const mechsChanged = () => themesMech !== null && themesMech.join(',') !== extraMechIds().join(',');
  function syncThemeBtn() {
    const b = $('#moreThemes'); if (!b || themesBusy) return;
    const stale = mechsChanged();
    b.classList.toggle('primary', stale); b.classList.toggle('refresh', stale); b.classList.toggle('ghost', !stale);
    b.textContent = stale ? '🔄 Refresh themes' : '✨ More themes';
    b.title = stale ? 'Your mechanics changed. Regenerate themes for the base game + the mechanics you picked.' : 'Add more themes for the base game + the mechanics you picked.';
    const n = $('#themeNote');
    if (n) n.innerHTML = stale ? `<span class="theme-stale">Mechanics changed. Tap <b>Refresh themes</b> to get themes made for ${esc(g.name)} + ${selMechs().filter((m) => m.id !== 'original').map((m) => esc(m.name)).join(' + ') || 'its original loop'}.</span>` : staleNote ? `<span class="muted small">${staleNote}</span>` : themesMech && themesMech.length ? `<span class="muted small">Themes made for ${esc(g.name)} + ${esc(themesMechLabel)}</span>` : '';
  }
  async function loadThemes(mode = '') { // '' = initial/cached, 'more', 'refresh'
    const b = $('#moreThemes'); themesBusy = true;
    const want = st.mechs.filter((x) => x !== 'original');
    try {
      if (mode) { b.disabled = true; b.textContent = mode === 'refresh' ? 'Refreshing…' : 'Thinking…'; }
      if (mode === 'refresh') $('#themes').innerHTML = '<div class="muted">Regenerating themes for the new mechanic mix…</div>';
      const qs = new URLSearchParams(); if (mode === 'more') qs.set('more', '1'); if (mode === 'refresh') qs.set('refresh', '1'); if (want.length) qs.set('mechs', want.join(','));
      const oldName = theme()?.name || st.themeName || null;
      const r = await api(`/api/games/${encodeURIComponent(id)}/themes${qs.toString() ? `?${qs}` : ''}`);
      themes = r.themes || [];
      themesMech = (r.mechanics || []).map((m) => m.id).sort(); themesMechLabel = (r.mechanics || []).map((m) => m.name).join(' + ');
      staleNote = '';
      if (mode === 'refresh' && st.themeId && !themes.some((t) => t.id === st.themeId)) {
        const old = oldName; st.themeId = null; st.themeName = null; save(); drawMerge();
        staleNote = old ? `Themes refreshed: your previous pick “${esc(old)}” was made for the old mechanic mix, so pick a new theme.` : 'Themes refreshed: pick a theme.';
        toast('Themes refreshed: pick a new theme');
      }
      if (r.original_mechanic) { const o = mechs.find((m) => m.id === 'original'); if (o) { o.desc = r.original_mechanic; drawMechs(); } g._orig = r.original_mechanic; }
      drawThemes(); summary();
    } catch (e) { $('#themes').innerHTML = `<div class="err">Couldn't load themes: ${esc(e.message)}</div>`; }
    finally { themesBusy = false; b.disabled = false; syncThemeBtn(); }
  }
  $('#moreThemes').onclick = () => loadThemes(mechsChanged() ? 'refresh' : 'more');

  // mechanics
  function drawMechs() {
    $('#mechs').innerHTML = mechs.map((m) => `<div class="card mech ${st.mechs.includes(m.id) ? 'on' : ''}" data-id="${m.id}"><div class="check">${st.mechs.includes(m.id) ? '✓' : ''}</div>
      <div class="mech-top"><div class="mech-emoji">${m.emoji}</div><h3>${esc(m.name)}</h3></div><p>${esc(m.desc)}</p>
      <div class="refs">${m.games.map((x) => `<span title="${esc(x.name)} (${x.score})">${iconImg(x, '', false)}</span>`).join('')}${m.refs.map((r) => `<span class="ref-chip">${esc(r)}</span>`).join('')}</div></div>`).join('');
    $('#mechs').querySelectorAll('.mech').forEach((c) => (c.onclick = () => {
      const mid = c.dataset.id; st.mechs = st.mechs.includes(mid) ? st.mechs.filter((x) => x !== mid) : [...st.mechs, mid]; save();
      c.classList.toggle('on'); c.querySelector('.check').textContent = st.mechs.includes(mid) ? '✓' : ''; summary(); drawMerge(); syncThemeBtn();
    }));
  }
  let mergeTimer = null, mergeSeq = 0;
  function drawMerge() {
    const m = selMechs(), el = $('#merge');
    if (m.length < 2) { el.innerHTML = ''; return; }
    el.innerHTML = `<div class="merge-panel"><div class="orbit"><div class="core"></div>${m.map((x, i) => `<span style="--i:${i};--n:${m.length}">${x.emoji}</span>`).join('')}</div>
      <div class="merge-text"><div class="label">Merging ${m.map((x) => esc(x.name)).join(' + ')}${theme() ? ` · ${esc(theme().name)}` : ''}</div><div id="mergeTxt" class="typing muted">Fusing mechanics…</div></div></div>`;
    clearTimeout(mergeTimer); const seq = ++mergeSeq;
    mergeTimer = setTimeout(async () => {
      try {
        const r = await api('/api/merge', { method: 'POST', body: { gameId: id, theme: theme() || null, mechanics: m.map(({ id, name, desc }) => ({ id, name, desc })) } });
        if (seq !== mergeSeq) return; typeOut($('#mergeTxt'), r.summary);
      } catch (e) { if (seq === mergeSeq) { $('#mergeTxt').className = ''; $('#mergeTxt').innerHTML = `<span style="color:#ffc2cb">⚠️ ${esc(e.message)}</span>`; } }
    }, 700);
  }
  function typeOut(el, txt) { if (!el) return; el.className = 'typing'; el.textContent = ''; let i = 0; const t = setInterval(() => { el.textContent = txt.slice(0, (i += 3)); if (i >= txt.length) { clearInterval(t); el.className = ''; } }, 16); }

  // ideas
  let history = [];
  async function loadHistory() {
    try { history = await api(`/api/ideas?gameId=${encodeURIComponent(id)}`); } catch { history = []; }
    drawHistory();
  }
  function drawHistory() {
    $('#history').innerHTML = history.length ? `<div class="section-title" style="margin-top:22px;font-size:14px">Idea history (${history.length})</div><div class="history">${history.map((h) => `<div class="hist ${h.id === st.ideaId ? 'on' : ''}" data-id="${h.id}"><img src="${esc(h.files.still || h.files.gif || '')}" alt=""><div>${esc(h.concept.title)}</div></div>`).join('')}</div>` : '';
    $('#history').querySelectorAll('.hist').forEach((el) => (el.onclick = () => { st.ideaId = el.dataset.id; save(); showIdea(history.find((h) => h.id === el.dataset.id)); drawHistory(); }));
  }
  function progressHtml(j) {
    return `<div class="progress">${j.steps.map((s) => `<div class="pstep ${s.state}"><span class="dot">${s.state === 'done' ? '✓' : s.state === 'error' ? '!' : ''}</span>${esc(s.label)}${s.note ? ` <span class="muted small">(${esc(s.note)})</span>` : ''}</div>`).join('')}</div>
      <div class="log">${j.log.map(esc).join('<br>') || 'Starting…'}</div>${j.error ? `<div class="err">⚠️ ${esc(j.error)}</div>` : ''}`;
  }
  async function generate(isNew = false) {
    const t = theme(), m = selMechs(); if (!t || !m.length) return;
    $('#stepIdea').scrollIntoView({ behavior: 'smooth', block: 'start' });
    $('#genBtn').disabled = true;
    const box = $('#idea');
    box.innerHTML = '<div class="muted">Starting…</div>';
    try {
      const previous = isNew ? history.filter((h) => h.theme?.name === t.name).slice(0, 8).map((h) => `${h.concept.title}: ${h.concept.hook}`) : [];
      const { jobId } = await api('/api/ideas', { method: 'POST', body: { gameId: id, theme: t, mechanics: m.map(({ id, name, desc }) => ({ id, name, desc })), previous } });
      const j = await pollJob(jobId, (j) => (box.innerHTML = progressHtml(j)));
      if (j.status === 'done') { st.ideaId = j.result.id; save(); history.unshift(j.result); showIdea(j.result); drawHistory(); toast(`New idea: ${j.result.concept.title}`); }
    } catch (e) { box.innerHTML = `<div class="err">⚠️ ${esc(e.message)}</div>`; toast(e.message, true); }
    finally { summary(); }
  }
  $('#genBtn').onclick = () => generate(history.length > 0);

  function showIdea(idea) {
    if (!idea) return;
    const c = idea.concept, f = idea.files;
    const modes = [f.gif && 'GIF', 'Live', f.frames?.length && 'Frames'].filter(Boolean);
    let modeNow = modes[0];
    $('#idea').innerHTML = `<div class="idea">
      <div><div class="phone"><div class="screen" id="ideaScreen"></div></div><div class="tabs">${modes.map((m) => `<button class="tab" data-m="${m}">${m}</button>`).join('')}</div>
        ${idea.gifError ? `<div class="err small">GIF capture failed (${esc(idea.gifError)}); showing live animated mockup instead.</div>` : ''}
        <div style="text-align:center">${f.gif ? `<a class="btn ghost" href="${f.gif}" download="${esc(c.title)}.gif" style="padding:8px 14px;font-size:13px">⬇ GIF</a>` : ''} <a class="btn ghost" href="${f.mockupHtml}" target="_blank" style="padding:8px 14px;font-size:13px">↗ Open mockup</a></div></div>
      <div class="concept"><h2>${esc(c.title)}</h2><div class="tag">${esc(c.tagline || '')}</div>
        <dl class="kv">
          <dt>Hook</dt><dd>${esc(c.hook)}</dd>
          <dt>Core loop</dt><dd><ol>${(c.core_loop || []).map((s) => `<li>${esc(s)}</li>`).join('')}</ol></dd>
          <dt>Mechanics merge</dt><dd>${esc(c.mechanics_merge)}</dd>
          <dt>Theme & art</dt><dd>${esc(c.art_direction)}<div class="swatches">${(c.palette || []).map((p) => `<i style="background:${esc(p)}"></i>`).join('')}</div></dd>
          <dt>Progression</dt><dd>${esc(c.progression)}</dd>
          <dt>Monetization</dt><dd>${esc(c.monetization)}</dd>
          <dt>Win / lose</dt><dd>${esc(c.win_lose || '')}</dd>
          <dt>Inputs</dt><dd>${esc(idea.theme?.name)} · ${idea.mechanics.map((m) => esc(m.name)).join(' + ')} <span class="muted small">(${esc(idea.model)})</span></dd>
        </dl>
        <div class="idea-actions"><button class="btn ghost" id="newBtn">🔄 Present new</button><button class="btn cyan" id="h5Btn">🎮 Create H5</button></div>
      </div></div>`;
    let slideT = null;
    const setMode = (m) => {
      modeNow = m; clearInterval(slideT);
      document.querySelectorAll('#idea .tab').forEach((t) => t.classList.toggle('on', t.dataset.m === m));
      const s = $('#ideaScreen');
      if (m === 'GIF') s.innerHTML = `<img src="${f.gif}" alt="">`;
      else if (m === 'Live') s.innerHTML = `<iframe sandbox="allow-scripts" src="${f.mockupHtml}" scrolling="no"></iframe>`;
      else { let i = 0; s.innerHTML = `<img src="${f.frames[0]}" alt="">`; slideT = setInterval(() => { i = (i + 1) % f.frames.length; const im = s.querySelector('img'); if (im) im.src = f.frames[i]; else clearInterval(slideT); }, 700); }
    };
    document.querySelectorAll('#idea .tab').forEach((t) => (t.onclick = () => setMode(t.dataset.m)));
    setMode(modeNow);
    $('#newBtn').onclick = () => generate(true);
    $('#h5Btn').onclick = () => createH5(idea);
    api(`/api/ideas/${idea.id}`).then((full) => { if (full.builds?.length) showBuild(full.builds[0], full.builds); else $('#stepH5').style.display = 'none'; }).catch(() => {});
  }

  // H5
  async function createH5(idea) {
    $('#stepH5').style.display = ''; $('#stepH5').scrollIntoView({ behavior: 'smooth' });
    const box = $('#h5'); box.innerHTML = '<div class="muted">Starting build…</div>';
    $('#h5Btn').disabled = true;
    try {
      const { jobId } = await api('/api/h5', { method: 'POST', body: { ideaId: idea.id } });
      const j = await pollJob(jobId, (j) => (box.innerHTML = progressHtml(j)));
      if (j.status === 'done') { showBuild(j.result); toast(`H5 ready: ${j.result.title}`); }
    } catch (e) { box.innerHTML = `<div class="err">⚠️ ${esc(e.message)}</div>`; toast(e.message, true); }
    finally { const b = $('#h5Btn'); if (b) b.disabled = false; }
  }
  function showBuild(b, all = []) {
    $('#stepH5').style.display = '';
    const v = b.validation || {};
    const last = (v.rounds || []).slice(-1)[0];
    $('#h5').innerHTML = `<div class="h5wrap"><div><div class="phone game"><div class="screen"><iframe src="${b.url}" allow="autoplay" title="game"></iframe></div></div></div>
      <div><h2 style="margin:0 0 6px;font-size:26px">${esc(b.title)}</h2><div class="muted small">Built ${new Date(b.createdAt).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })} IST · ${esc(b.provider)} / ${esc(b.model)}</div>
      <div style="margin:14px 0">${v.ok ? `<div class="okbox">✅ Passed headless Chrome validation${v.rounds.length > 1 ? ` after ${v.rounds.length - 1} auto-fix round(s)` : ''} (no JS errors, renders, responds to taps).</div>` : v.skipped ? `<div class="err">Validation skipped: ${esc(v.skipped)}</div>` : `<div class="err">⚠️ Still has issues after ${v.rounds?.length || 0} round(s):<br>${(last?.errors || []).map(esc).join('<br>')}</div>`}</div>
      <div class="idea-actions"><a class="btn cyan" href="${b.url}" target="_blank">▶ Play full screen</a><a class="btn ghost" href="${b.zip}">⬇ Download .zip</a><button class="btn ghost" id="rebuild">🔁 Rebuild</button></div>
      <p class="muted small" style="margin-top:16px">Saved to <code>games/${esc(b.slug)}/index.html</code> (single HTML with embedded SVG art; assets also in <code>assets/</code>).</p>
      ${all.length > 1 ? `<div class="muted small">Other builds: ${all.slice(1).map((x) => `<a href="${x.url}" target="_blank" style="color:#8be9ff">${esc(x.slug)}</a>`).join(', ')}</div>` : ''}</div></div>`;
    $('#rebuild').onclick = () => createH5(history.find((h) => h.id === b.ideaId) || { id: b.ideaId });
  }

  // boot
  try { mechs = await api(`/api/games/${encodeURIComponent(id)}/mechanics`); if (g._orig) mechs[0].desc = g._orig; drawMechs(); } catch (e) { $('#mechs').innerHTML = `<div class="err">${esc(e.message)}</div>`; }
  summary();
  loadThemes().then(drawMerge);
  await loadHistory();
  if (st.ideaId) { const h = history.find((x) => x.id === st.ideaId); if (h) showIdea(h); }
}


// ---------- Rate My Game ----------
const RATE_JOB = 'golu.rateJob';
const fmtBytes = (n) => (n > 1e9 ? `${(n / 1e9).toFixed(2)} GB` : n > 1e6 ? `${(n / 1e6).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1e3))} KB`);
const fileIco = (name) => { const e = (name.split('.').pop() || '').toLowerCase(); return /^(mp4|mov|webm|mkv|avi|m4v)$/.test(e) ? '🎬' : /^(png|jpe?g|webp|gif|svg|heic|avif)$/.test(e) ? '🖼️' : /^html?$/.test(e) ? '🌐' : /^(zip)$/.test(e) ? '🗜️' : /^(apk|aab|ipa|xapk)$/.test(e) ? '📱' : /^pdf$/.test(e) ? '📕' : /^(docx?|pptx?|xlsx?|key|pages)$/.test(e) ? '📄' : '📦'; };
const SHORT = { momentum: 'Momentum', staying: 'Staying', size: 'Size', hook: 'Hook', monetisation: 'Monetisation', theme: 'Theme', feasibility: 'Feasibility', mashup: 'Mashup' };
const confCls = (c) => (c === 'high' ? 'ok' : c === 'medium' ? '' : 'warn');
async function refreshRatedCount() {
  try { const d = await api('/api/rated'); const b = $('#ratedCount'); if (b) { b.textContent = d.count; b.hidden = !d.count; } return d; } catch { return null; }
}
function radarSvg(pillars, size = 320) {
  const n = pillars.length, c = size / 2, R = size / 2 - 62;
  const pt = (i, v) => { const a = -Math.PI / 2 + (2 * Math.PI * i) / n; return [c + Math.cos(a) * R * (v / 10), c + Math.sin(a) * R * (v / 10)]; };
  const rings = [2, 4, 6, 8, 10].map((v) => `<polygon points="${pillars.map((_, i) => pt(i, v).join(',')).join(' ')}" fill="none" stroke="rgba(255,255,255,${v === 10 ? 0.18 : 0.07})"/>`).join('');
  const spokes = pillars.map((_, i) => `<line x1="${c}" y1="${c}" x2="${pt(i, 10)[0]}" y2="${pt(i, 10)[1]}" stroke="rgba(255,255,255,.07)"/>`).join('');
  const poly = pillars.map((p, i) => pt(i, p.score).join(',')).join(' ');
  const dots = pillars.map((p, i) => { const [x, y] = pt(i, p.score); return `<circle cx="${x}" cy="${y}" r="4.5" fill="#22d3ee" stroke="#070a16" stroke-width="2"/>`; }).join('');
  const labels = pillars.map((p, i) => { const [x, y] = pt(i, 12.4); const anchor = Math.abs(x - c) < 8 ? 'middle' : x > c ? 'start' : 'end';
    return `<text x="${x}" y="${y}" text-anchor="${anchor}" font-size="11" fill="#c9cff5" font-weight="700">${esc(SHORT[p.key] || p.label)}</text><text x="${x}" y="${y + 14}" text-anchor="${anchor}" font-size="12" fill="#fff" font-weight="900">${p.score}</text>`; }).join('');
  return `<svg class="radar" viewBox="-40 -6 ${size + 80} ${size + 12}" width="100%" style="max-width:${size + 80}px"><defs><linearGradient id="rg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#7b6cff" stop-opacity=".75"/><stop offset="1" stop-color="#ff5da2" stop-opacity=".55"/></linearGradient></defs>${rings}${spokes}<polygon points="${poly}" fill="url(#rg)" stroke="#a99cff" stroke-width="2"/>${dots}${labels}</svg>`;
}
function barsHtml(pillars) {
  return `<div class="pbars">${pillars.map((p) => `<div class="pbar"><div class="pbar-top"><b>${esc(p.label)}</b><span class="muted small">weight ${p.weight}</span><span class="pbar-score ${scoreCls(p.score)}">${p.score}</span></div><div class="pbar-track"><div class="pbar-fill ${scoreCls(p.score)}" style="width:${p.score * 10}%"></div></div><div class="pbar-why">${esc(p.reason || '')}</div></div>`).join('')}</div>`;
}
const scoreBadge = (s, big = false) => `<div class="sbadge ${scoreCls(s)} ${big ? 'big' : ''}"><span>${Number(s).toFixed(1)}</span><small>/10</small></div>`;

let rateState = { sort: 'date', q: '' };
async function renderRate(focus) {
  if (!ratings) loadRatings().catch(() => {});
  app.innerHTML = `
    <h1 class="page">⭐ Rate My Game</h1>
    <p class="page-sub">Drop anything: a gameplay video, screenshots, an HTML or zipped H5 build, an APK, a pitch PDF or doc. Golu extracts frames, screenshots and text, Pintu's v2 rubric judges it, and the score is computed in code with Pintu's weights and caps.</p>
    <div class="rate-grid">
      <form id="rateForm" class="rate-panel">
        <label id="drop" class="drop"><input id="fileIn" type="file" multiple hidden>
          <div class="drop-ico">📤</div><div class="drop-title">Drag &amp; drop files here, or click to browse</div>
          <div class="muted small">Any type, multiple files: mp4 / mov / webm · png / jpg / gif · html / zip (H5) · apk / ipa · pdf / docx / pptx · txt / md</div></label>
        <div id="fileList" class="file-list"></div>
        <div class="row2"><label>Game name <span class="muted small">(optional)</span><input id="rName" placeholder="e.g. Jelly Sort Saga"></label>
        <label>Genre <span class="muted small">(optional)</span><input id="rGenre" placeholder="e.g. sort puzzle, merge, runner"></label></div>
        <label>Notes <span class="muted small">(optional: core loop, monetisation, target audience, test KPIs like D1 / D7 / CPI)</span><textarea id="rNotes" rows="3" placeholder="Anything Pintu should know"></textarea></label>
        <div class="rate-actions"><button id="rateGo" class="btn primary" type="submit" disabled>⭐ Rate it</button><span class="muted small">Confidence: low for images/text only · medium with a playable HTML build or video · high with real test KPIs</span></div>
        <div id="rateProg"></div>
      </form>
      <aside class="rate-panel rubric-card">
        <div class="rubric-head"><b>Pintu scoring v2</b><span class="chip">rubric v2 · 18 Nov 2026</span></div>
        <ul class="rubric-list">
          <li><span>Market momentum</span><b>25</b></li><li><span>Staying power</span><b>10</b></li><li><span>Market size &amp; proof</span><b>15</b></li>
          <li><span>Hook &amp; core loop <em>(½ hook, ½ input simplicity)</em></span><b>20</b></li><li><span>Monetisation fit</span><b>10</b></li><li><span>Theme &amp; live-ops</span><b>10</b></li>
          <li><span>Feasibility &amp; twist</span><b>10</b></li><li><span>Mashup <em>(only with 2+ mechanics; others ×0.9)</em></span><b>10</b></li></ul>
        <p class="muted small">Momentum, staying power and size are borrowed from the 3-5 closest games in Pintu's catalogue (weighted median − 1). Caps: distinct tap + swipe or 3+ inputs → 5.0 · mashup ≤ 4 → 6.0. Drag-to-merge is never capped.</p>
      </aside>
    </div>
    <div id="catalogue"></div>`;
  let files = [];
  const drawFiles = () => {
    $('#fileList').innerHTML = files.map((f, i) => `<div class="fitem"><span>${fileIco(f.name)}</span><span class="fname">${esc(f.name)}</span><span class="muted small">${fmtBytes(f.size)}</span><button type="button" class="x" data-i="${i}" title="Remove">✕</button></div>`).join('');
    $('#fileList').querySelectorAll('.x').forEach((b) => (b.onclick = () => { files.splice(+b.dataset.i, 1); drawFiles(); }));
    $('#rateGo').disabled = !files.length;
    if (files.length && !$('#rName').value) $('#rName').placeholder = files[0].name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ');
  };
  const add = (list) => { for (const f of list) if (!files.some((x) => x.name === f.name && x.size === f.size)) files.push(f); drawFiles(); };
  const drop = $('#drop');
  $('#fileIn').onchange = (e) => { add(e.target.files); e.target.value = ''; };
  ['dragenter', 'dragover'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add('over'); }));
  ['dragleave', 'drop'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove('over'); }));
  drop.addEventListener('drop', (e) => add(e.dataTransfer.files));
  $('#rateForm').onsubmit = async (e) => {
    e.preventDefault(); if (!files.length) return;
    const fd = new FormData(); files.forEach((f) => fd.append('files', f, f.name));
    fd.append('name', $('#rName').value.trim()); fd.append('genre', $('#rGenre').value.trim()); fd.append('notes', $('#rNotes').value.trim());
    $('#rateGo').disabled = true; const prog = $('#rateProg');
    try {
      const out = await new Promise((resolve, reject) => {
        const x = new XMLHttpRequest(); x.open('POST', '/api/rate');
        const h = headers(); delete h['content-type']; Object.entries(h).forEach(([k, v]) => x.setRequestHeader(k, v));
        x.upload.onprogress = (ev) => { if (ev.lengthComputable) prog.innerHTML = `<div class="upbar"><div style="width:${(ev.loaded / ev.total) * 100}%"></div></div><div class="muted small">Uploading ${fmtBytes(ev.loaded)} of ${fmtBytes(ev.total)}…</div>`; };
        x.onload = () => { let d; try { d = JSON.parse(x.responseText); } catch { d = { error: x.responseText || `HTTP ${x.status}` }; } x.status < 300 ? resolve(d) : reject(new Error(d.error || `HTTP ${x.status}`)); };
        x.onerror = () => reject(new Error('Upload failed (connection lost)')); x.send(fd);
      });
      sessionStorage.setItem(RATE_JOB, JSON.stringify(out));
      files = []; drawFiles(); await followRateJob(out);
    } catch (err) { prog.innerHTML = `<div class="err">⚠️ ${esc(err.message)}</div>`; toast(err.message, true); $('#rateGo').disabled = !files.length; }
  };
  try { const pending = JSON.parse(sessionStorage.getItem(RATE_JOB) || 'null'); if (pending) followRateJob(pending); } catch {}
  await drawCatalogue();
  if (focus === 'catalogue') $('#catalogue').scrollIntoView({ behavior: 'smooth' });
}
function rateProgressHtml(j) {
  const secs = Math.round(((j.finishedAt || Date.now()) - j.startedAt) / 1000);
  return `<div class="progress">${j.steps.map((s) => `<div class="pstep ${s.state}"><span class="dot">${s.state === 'done' ? '✓' : s.state === 'error' ? '!' : ''}</span>${esc(s.label)}${s.note ? ` <span class="muted small">(${esc(s.note)})</span>` : ''}</div>`).join('')}</div>
    <div class="muted small" style="margin-top:8px">${j.status === 'running' ? `⏱ ${Math.floor(secs / 60)}m ${secs % 60}s · the AI judging step usually takes 1-5 minutes` : ''}</div>
    <div class="log">${j.log.map(esc).join('<br>') || 'Starting…'}</div>${j.error ? `<div class="err">⚠️ ${esc(j.error)}</div>` : ''}`;
}
async function followRateJob({ jobId, id }) {
  const prog = $('#rateProg'); if (!prog) return;
  try {
    const j = await pollJob(jobId, (j) => { if ($('#rateProg')) $('#rateProg').innerHTML = rateProgressHtml(j); });
    sessionStorage.removeItem(RATE_JOB);
    if (j.status === 'done') { toast(`Rated: ${j.result.overall}/10`); refreshRatedCount(); location.hash = `#/rate/${id}`; }
    else if ($('#rateProg')) {
      $('#rateProg').insertAdjacentHTML('beforeend', `<button class="btn ghost" id="retryRate" type="button">↻ Retry rating</button>`);
      $('#retryRate').onclick = async () => { try { const out = await api(`/api/rated/${id}/retry`, { method: 'POST' }); sessionStorage.setItem(RATE_JOB, JSON.stringify(out)); followRateJob(out); } catch (e) { toast(e.message, true); } };
    }
  } catch (e) { sessionStorage.removeItem(RATE_JOB); if ($('#rateProg')) $('#rateProg').innerHTML = `<div class="err">⚠️ ${esc(e.message)}</div>`; }
}
async function drawCatalogue() {
  const el = $('#catalogue'); if (!el) return;
  const d = await refreshRatedCount() || { count: 0, games: [] };
  const avg = d.count ? (d.games.reduce((a, g) => a + g.overall, 0) / d.count).toFixed(1) : '–';
  const q = rateState.q.toLowerCase();
  let list = d.games.filter((g) => !q || `${g.name} ${g.genre} ${g.short_reason}`.toLowerCase().includes(q));
  const sorters = { date: (a, b) => b.created_at.localeCompare(a.created_at), score: (a, b) => b.overall - a.overall || b.created_at.localeCompare(a.created_at), low: (a, b) => a.overall - b.overall, name: (a, b) => a.name.localeCompare(b.name) };
  list = [...list].sort(sorters[rateState.sort] || sorters.date);
  el.innerHTML = `<div class="cat-head"><div class="cat-count"><span class="big-num">${d.count}</span><div><b>game${d.count === 1 ? '' : 's'} rated</b><div class="muted small">Average ${avg}/10 · ${esc(d.rubric_version || 'Pintu v2')}</div></div></div>
      <div class="toolbar" style="margin:0"><div class="pills">${[['date', 'Newest'], ['score', 'Top score'], ['low', 'Lowest'], ['name', 'A–Z']].map(([k, l]) => `<button class="pill ${rateState.sort === k ? 'on' : ''}" data-sort="${k}">${l}</button>`).join('')}</div>
      <label class="search" style="min-width:220px">🔎<input id="catQ" placeholder="Search rated games…" value="${esc(rateState.q)}"></label></div></div>
    ${d.count ? `<div class="cat-list">${list.map((g) => `<div class="cat-row" data-id="${g.id}">
        <div class="cat-thumb">${g.thumb ? `<img src="${esc(g.thumb)}" alt="" loading="lazy">` : `<span>${fileIco(g.files?.[0]?.file || '')}</span>`}</div>
        <div class="cat-main"><div class="cat-title"><b>${esc(g.name)}</b>${g.genre ? `<span class="chip">${esc(g.genre)}</span>` : ''}<span class="chip ${confCls(g.confidence)}">${esc(g.confidence)} confidence</span>${g.cap ? '<span class="chip warn">capped</span>' : ''}</div>
          <div class="cat-why"><b>Why:</b> ${esc(g.short_reason || g.one_line || '')}</div>
          <div class="cat-mini">${Object.entries(g.scores || {}).map(([k, v]) => `<span title="${esc(k)}"><i class="${scoreCls(v)}"></i>${esc(SHORT[k] || k)} ${v}</span>`).join('')}</div>
          <div class="muted small">${fmtIST(g.created_at)} · ${(g.files || []).length} file${(g.files || []).length === 1 ? '' : 's'}${g.comparables?.length ? ` · like ${esc(g.comparables.slice(0, 3).join(', '))}` : ''} · ${esc(g.rubric_version || '')}</div></div>
        <div class="cat-side">${scoreBadge(g.overall)}<button class="x del" data-id="${g.id}" title="Delete from catalogue">🗑</button></div></div>`).join('') || '<div class="empty">No matches.</div>'}</div>`
      : '<div class="empty">No games rated yet. Upload one above to start the catalogue.</div>'}`;
  el.querySelectorAll('[data-sort]').forEach((b) => (b.onclick = () => { rateState.sort = b.dataset.sort; drawCatalogue(); }));
  const cq = $('#catQ'); if (cq) cq.oninput = () => { rateState.q = cq.value; clearTimeout(cq._t); cq._t = setTimeout(() => drawCatalogue().then(() => { const n = $('#catQ'); n.focus(); n.setSelectionRange(n.value.length, n.value.length); }), 250); };
  el.querySelectorAll('.cat-row').forEach((r) => (r.onclick = (e) => { if (e.target.closest('.del')) return; location.hash = `#/rate/${r.dataset.id}`; }));
  el.querySelectorAll('.del').forEach((b) => (b.onclick = async (e) => { e.stopPropagation(); if (!confirm('Delete this rating and its uploaded files?')) return; try { await api(`/api/rated/${b.dataset.id}`, { method: 'DELETE' }); toast('Deleted'); drawCatalogue(); } catch (err) { toast(err.message, true); } }));
}
async function renderRatedReport(id) {
  if (!ratings) loadRatings().catch(() => {});
  app.innerHTML = '<div class="muted">Loading report…</div>';
  const r = await api(`/api/rated/${encodeURIComponent(id)}`);
  const s = r.score;
  const visuals = r.files.flatMap((f) => f.visuals || []);
  app.innerHTML = `
    <div class="crumbs"><a href="#/rate">← Rate My Game</a> · <a href="#/rated">Catalogue</a></div>
    <div class="report-hero">
      <div class="report-thumb">${r.thumb ? `<img src="${esc(r.thumb)}" alt="">` : `<span>${fileIco(r.files[0]?.file || '')}</span>`}</div>
      <div class="report-head">
        <div class="cat-title"><span class="chip">📐 ${esc(r.rubric_version)}</span><span class="chip ${confCls(r.confidence)}">${esc(r.confidence)} confidence</span>${r.meta.genre ? `<span class="chip">${esc(r.meta.genre)}</span>` : ''}<span class="chip">${esc(s.input.label)} · input ${s.input.score}</span></div>
        <h1 class="page" style="margin-top:10px">${esc(r.meta.name)}</h1>
        <p class="report-line">${esc(r.one_line)}</p>
        <div class="muted small">Rated ${fmtIST(r.created_at)} · ${r.files.length} file${r.files.length === 1 ? '' : 's'} · AI: ${esc(r.provider)}</div>
      </div>
      <div class="report-score">${scoreBadge(r.overall, true)}<div class="muted small" style="text-align:center;margin-top:6px">Overall${s.cap ? `<br><span class="warn-t">capped from ${s.overall_uncapped}</span>` : ''}</div></div>
    </div>
    <div class="report-grid">
      <div class="rate-panel"><div class="section-title" style="font-size:15px">Score by pillar</div>${radarSvg(s.pillars)}</div>
      <div class="rate-panel"><div class="section-title" style="font-size:15px">Why this score</div>
        <p class="why-p">${esc(r.summary)}</p><p class="why-p"><b>Drivers:</b> ${esc(r.drivers)}</p>
        ${s.cap ? `<div class="err" style="margin:8px 0">🔒 Cap applied: ${esc(s.cap)}</div>` : ''}
        <div class="formula">${esc(s.formula)}</div>
        ${r.evidence_seen ? `<p class="muted small"><b>What Pintu could see:</b> ${esc(r.evidence_seen)}</p>` : ''}</div>
    </div>
    <div class="section-title">Pillar breakdown</div>${barsHtml(s.pillars)}
    <div class="report-grid three">
      <div class="rate-panel"><div class="section-title" style="font-size:15px">💪 Strengths</div><ul class="blist">${r.strengths.map((x) => `<li>${esc(x)}</li>`).join('')}</ul></div>
      <div class="rate-panel"><div class="section-title" style="font-size:15px">⚠️ Weaknesses</div><ul class="blist">${r.weaknesses.map((x) => `<li>${esc(x)}</li>`).join('')}</ul></div>
      <div class="rate-panel"><div class="section-title" style="font-size:15px">🚀 Changes that would raise the score</div><ol class="blist">${r.improvements.map((x) => `<li><b>${esc(x.change || x)}</b>${x.pillar ? ` <span class="chip">${esc(x.pillar)}</span>` : ''}${x.why ? `<div class="muted small">${esc(x.why)}</div>` : ''}</li>`).join('')}</ol></div>
    </div>
    <div class="section-title">Comparables from Pintu's catalogue <span class="muted small" style="font-weight:500">(momentum / staying / size borrowed from these, minus 1)</span></div>
    <div class="comp-list">${r.comparables.map((c) => `<a class="comp" ${c.store_url ? `href="${esc(c.store_url)}" target="_blank" rel="noopener"` : ''}>${c.icon ? `<img src="${esc(c.icon)}" referrerpolicy="no-referrer" alt="" onerror="this.style.visibility='hidden'">` : '<span class="ci">🎮</span>'}<div><b>${esc(c.name)}</b><div class="muted small">${esc(c.category || '')} · Pintu ${c.overall} · M ${c.scores.momentum} / S ${c.scores.staying} / Z ${c.scores.size} · similarity ${c.similarity}/3</div><div class="small">${esc(c.why)}</div></div></a>`).join('')}</div>
    <div class="muted small" style="margin-top:6px">Comparables source: ${esc(r.comparables_source)}</div>
    ${r.deconstruct && Object.keys(r.deconstruct).length ? `<div class="section-title">Deconstruction</div><dl class="kv rate-panel">${[['Core mechanic', r.deconstruct.core_mechanic], ['Extra mechanics', (r.deconstruct.extra_mechanics || []).join(', ')], ['Meta', r.deconstruct.meta], ['Theme', r.deconstruct.theme], ['Monetisation', r.deconstruct.monetisation], ['Tags', (r.deconstruct.genre_tags || []).join(', ')], ['Archetype', r.archetype]].filter(([, v]) => v).map(([k, v]) => `<dt>${k}</dt><dd>${esc(v)}</dd>`).join('')}</dl>` : ''}
    <div class="section-title">Files analysed</div>
    <div class="rate-panel">${r.files.map((f) => `<div class="fitem"><span>${fileIco(f.file)}</span><span class="fname">${esc(f.file)}</span><span class="muted small">${fmtBytes(f.size)} · ${esc(f.summary)}</span></div>`).join('')}
      ${visuals.length ? `<div class="visuals">${visuals.map((v) => `<a href="${esc(v)}" target="_blank"><img src="${esc(v)}" loading="lazy" alt=""></a>`).join('')}</div>` : ''}</div>
    <div class="idea-actions"><a class="btn primary" href="#/rate">⭐ Rate another game</a><button class="btn ghost" id="delRep">🗑 Delete this rating</button></div>`;
  $('#delRep').onclick = async () => { if (!confirm('Delete this rating and its uploaded files?')) return; await api(`/api/rated/${id}`, { method: 'DELETE' }); toast('Deleted'); location.hash = '#/rated'; };
  window.scrollTo(0, 0);
}

// ---------- router ----------
async function route() {
  const h = location.hash || '#/';
  try {
    document.querySelector('.rate-btn')?.classList.toggle('on', h.startsWith('#/rate'));
    if (h.startsWith('#/game/')) await renderGame(decodeURIComponent(h.slice(7)));
    else if (h.startsWith('#/rate/')) await renderRatedReport(decodeURIComponent(h.slice(7)));
    else if (h === '#/rate' || h === '#/rate/') await renderRate();
    else if (h.startsWith('#/rated') || h.startsWith('#/catalogue')) await renderRate('catalogue');
    else await renderHome();
  } catch (e) { app.innerHTML = `<div class="err">⚠️ ${esc(e.message)}</div>`; }
}
window.addEventListener('hashchange', route);
loadConfig().finally(route);
refreshRatedCount();
