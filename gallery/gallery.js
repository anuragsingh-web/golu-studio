(function () {
  const list = document.getElementById('list');
  const toolbar = document.getElementById('toolbar');
  const sortEl = document.getElementById('sort');
  const minEl = document.getElementById('min');
  const minLabel = document.getElementById('minLabel');
  const nightEl = document.getElementById('night');
  const showing = document.getElementById('showing');
  const lede = document.getElementById('lede');
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  function fmtNight(iso) {
    if (!iso) return '';
    const [y, m, d] = String(iso).split('-');
    return `${Number(d)} ${MONTHS[Number(m) - 1] || m} ${y}`;
  }
  function esc(s) {
    return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
  function num(n) {
    const x = Number(n);
    return Number.isFinite(x) ? (Math.round(x * 10) / 10).toFixed(1) : '–';
  }

  let data = { games: [] };

  function params() {
    return new URLSearchParams(location.search);
  }
  function writeParams() {
    const p = new URLSearchParams();
    if (sortEl.value !== 'new') p.set('sort', sortEl.value);
    if (Number(minEl.value) > 0) p.set('min', minEl.value);
    if (nightEl.value) p.set('night', nightEl.value);
    const q = p.toString();
    history.replaceState(null, '', q ? `?${q}` : location.pathname);
  }
  function readParams() {
    const p = params();
    if (p.get('sort') && [...sortEl.options].some((o) => o.value === p.get('sort'))) sortEl.value = p.get('sort');
    if (p.get('min')) minEl.value = p.get('min');
    minLabel.textContent = Number(minEl.value).toFixed(1).replace(/\.0$/, '');
    if (p.get('night')) nightEl.value = p.get('night');
  }

  function scoreClass(score) { return Number(score) >= 8 ? 'score great' : 'score'; }

  function card(g) {
    const media = g.gif || g.screenshot;
    const reads = g.reads || {};
    const mechs = (g.mechanics || []).map((m) => `<span class="chip">${esc(m.name || m)}</span>`).join('');
    const pillars = (g.pillars || []).map((p) => `<span>${esc(p.label)} <b>${num(p.score)}</b></span>`).join('');
    const href = g.play || `games/${encodeURIComponent(g.slug)}/index.html`;
    return `<article class="card">
      <a class="media" href="${esc(href)}" target="_blank" rel="noopener">
        ${media ? `<img src="${esc(media)}" alt="${esc(g.title)} screenshot">` : ''}
        <span class="${scoreClass(g.score)}">${num(g.score)}</span>
        ${g.mock ? '<span class="demo">DEMO</span>' : ''}
      </a>
      <div class="body">
        <h2>${esc(g.title || 'Untitled')}</h2>
        <p class="pitch">${esc(g.pitch || g.tagline || '')}</p>
        <a class="play" href="${esc(href)}" target="_blank" rel="noopener">Play</a>
        <dl class="facts">
          <dt>Base</dt><dd>${esc(g.base_game?.name || '')}</dd>
          <dt>Theme</dt><dd>${esc(g.theme?.name || '')}</dd>
          <dt>Mechanics</dt><dd><div class="chips">${mechs}</div></dd>
          <dt>Night</dt><dd>${esc(fmtNight(g.night))}</dd>
        </dl>
        <div class="reads">
          <span class="read">Fun ${num(reads.fun)}</span>
          <span class="read">Novelty ${num(reads.novelty)}</span>
          <span class="read">Clarity ${num(reads.clarity)}</span>
          <span class="read">Market ${num(reads.market_fit)}</span>
        </div>
        <p class="verdict">${esc(g.verdict || '')}</p>
        ${pillars ? `<details><summary>Pintu sub-scores</summary><div class="pillars">${pillars}</div></details>` : ''}
      </div>
    </article>`;
  }

  function visible() {
    const min = Number(minEl.value) || 0;
    const night = nightEl.value;
    const rows = (data.games || []).filter((g) => (Number(g.score) || 0) >= min && (!night || g.night === night));
    const sorters = {
      new: (a, b) => String(b.created_at).localeCompare(String(a.created_at)),
      old: (a, b) => String(a.created_at).localeCompare(String(b.created_at)),
      score: (a, b) => (b.score - a.score) || String(b.created_at).localeCompare(String(a.created_at)),
      scoreAsc: (a, b) => (a.score - b.score) || String(b.created_at).localeCompare(String(a.created_at)),
    };
    rows.sort(sorters[sortEl.value] || sorters.new);
    return rows;
  }

  function render() {
    const rows = visible();
    const total = (data.games || []).length;
    if (!total) {
      list.innerHTML = `<div class="empty"><h2>No games yet</h2><p>The nightly run keeps only games that score ${esc(data.threshold ?? 7)} or higher and actually play. The first ones show up here after 1:00 AM IST.</p></div>`;
      showing.textContent = '';
      return;
    }
    if (!rows.length) {
      list.innerHTML = `<div class="empty"><h2>Nothing matches</h2><p>Loosen the score or pick another night.</p></div>`;
    } else list.innerHTML = rows.map(card).join('');
    showing.textContent = rows.length === total ? `${total} game${total === 1 ? '' : 's'}` : `${rows.length} of ${total}`;
  }

  function fillNights() {
    const nights = [...new Set((data.games || []).map((g) => g.night).filter(Boolean))].sort().reverse();
    const current = nightEl.value;
    nightEl.innerHTML = `<option value="">All nights</option>` + nights.map((n) => `<option value="${esc(n)}">${esc(fmtNight(n))}</option>`).join('');
    if (nights.includes(current)) nightEl.value = current;
  }

  function onChange() {
    minLabel.textContent = Number(minEl.value).toFixed(1).replace(/\.0$/, '');
    writeParams();
    render();
  }

  async function boot() {
    try {
      const res = await fetch('games.json', { cache: 'no-cache' });
      if (!res.ok) throw new Error(res.statusText);
      data = await res.json();
    } catch (e) {
      list.innerHTML = `<div class="empty"><h2>Gallery data missing</h2><p>${esc(e.message)}</p></div>`;
      return;
    }
    const n = (data.games || []).length;
    const last = data.last_run;
    if (last && last.tried) {
      lede.textContent = `Last night tried ${last.tried}, kept ${last.kept}. Showing games that scored\u00a0${data.threshold ?? 7}+.`;
    } else if (n) {
      lede.textContent = `${n} playable game${n === 1 ? '' : 's'}, newest first. Kept at ${data.threshold ?? 7}+ on Pintu's rubric.`;
    }
    if (n) {
      toolbar.hidden = false;
      fillNights();
      readParams();
      fillNights();
      readParams();
    }
    sortEl.addEventListener('change', onChange);
    minEl.addEventListener('input', onChange);
    nightEl.addEventListener('change', onChange);
    render();
  }
  boot();
})();
