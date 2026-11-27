// Offline MOCK provider: deterministic, good-looking placeholder content so the full flow works without a key.
const hash = (s) => { let h = 2166136261; for (const c of String(s)) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return h >>> 0; };
const PALS = [['#ff5d73', '#ffc145', '#4cd3c2', '#7b6cff', '#1b1f4b'], ['#ff9f45', '#ffe066', '#5ab0ff', '#ff8fd8', '#14213d'], ['#9be15d', '#00e3ae', '#ffd166', '#ef476f', '#0b3954'], ['#c77dff', '#ff9ecd', '#80ffdb', '#ffd6a5', '#240046'], ['#f4a261', '#e76f51', '#2a9d8f', '#e9c46a', '#264653']];
const EMO = ['🐱', '🐶', '🍩', '🌸', '🎃', '❄️', '🚀', '🏰', '🍄', '💎', '🌊', '🍓', '🦊', '⚙️', '🍰', '🌙'];
const pal = (s) => PALS[hash(s) % PALS.length];

function themes(game, mechs = []) {
  const seeds = String(game.theme_ideas || '').split(/[;,/]|\band\b/).map((s) => s.replace(/\b(spin[- ]?offs?|core already|already|e\.g\.|seasons?|themes?|skins?)\b/gi, '').replace(/\s+/g, ' ').trim()).filter((s) => s.length > 2 && s.length < 40).slice(0, 4);
  const pool = ['Cozy Candy Kingdom', 'Neon Space Station', 'Enchanted Forest Spirits', 'Pirate Treasure Cove', 'Kawaii Bakery', 'Ancient Egypt Relics', 'Alchemy Potion Lab', 'Toy Workshop', 'Deep Sea Aquarium', 'Robot Junkyard', 'Spooky Pumpkin Patch', 'Sushi Conveyor Bar'];
  const key = mechs.map((m) => m.id).sort().join(',');
  const off = key ? hash(key) % pool.length : 0;
  const extra = [...pool.slice(off), ...pool.slice(0, off)].slice(0, 6);
  const how = mechs.length ? ` Built for ${mechs.map((m) => m.name).join(' + ')}: pieces you can ${mechs.map((m) => m.name.toLowerCase()).join(' and ')}.` : '';
  const list = [...seeds.map((n) => ({ name: n[0].toUpperCase() + n.slice(1), source: 'pintu' })), ...extra.map((n) => ({ name: n, source: 'ai' }))].slice(0, 8);
  return list.map((t, i) => ({ ...t, id: `t${i}`, description: `${t.name} skin for ${game.name}: bright readable pieces, soft lighting, collectible seasonal set.${how}`, palette: pal(t.name).slice(0, 4), motifs: [EMO[hash(t.name) % EMO.length], EMO[(hash(t.name) >> 4) % EMO.length], EMO[(hash(t.name) >> 8) % EMO.length]] }));
}

function themeSvg(theme) {
  const p = theme.palette?.length ? theme.palette : pal(theme.name), m = theme.motifs || ['⭐', '💎', '🌙'];
  const h = hash(theme.name);
  const blobs = Array.from({ length: 7 }, (_, i) => `<circle cx="${(h >> i) % 400}" cy="${(h >> (i + 3)) % 400}" r="${30 + ((h >> i) % 60)}" fill="${p[i % p.length]}" opacity=".35"/>`).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 400"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${p[3] || '#7b6cff'}"/><stop offset="1" stop-color="#0b0f1e"/></linearGradient><filter id="b"><feGaussianBlur stdDeviation="18"/></filter></defs><rect width="400" height="400" fill="url(#g)"/><g filter="url(#b)">${blobs}</g>
<rect x="60" y="120" width="280" height="200" rx="28" fill="rgba(255,255,255,.12)" stroke="rgba(255,255,255,.4)" stroke-width="3"/>
${[0, 1, 2].map((i) => `<rect x="${90 + i * 80}" y="150" width="60" height="140" rx="24" fill="rgba(255,255,255,.15)" stroke="#fff" stroke-opacity=".5"/>${[0, 1, 2].map((k) => `<circle cx="${120 + i * 80}" cy="${265 - k * 44}" r="19" fill="${p[(i + k) % p.length]}"/>`).join('')}`).join('')}
<text x="200" y="85" font-size="56" text-anchor="middle">${m.join('')}</text><text x="200" y="365" fill="#fff" font-family="system-ui,sans-serif" font-weight="800" font-size="26" text-anchor="middle">${esc(theme.name).slice(0, 26)}</text></svg>`;
}
const esc = (s) => String(s).replace(/[<&>"]/g, (c) => ({ '<': '&lt;', '&': '&amp;', '>': '&gt;', '"': '&quot;' }[c]));

function mergeSummary(game, theme, mechs) {
  return `${theme.name} × ${mechs.map((m) => m.name).join(' + ')}: players ${mechs.some((m) => m.id === 'sorting') ? 'sort' : 'collect'} themed pieces from ${game.name}'s core loop, and every completed set ${mechs.some((m) => m.id === 'merge') ? 'merges into a higher-tier collectible' : 'unlocks a combo booster'} that powers the next ${mechs[1]?.name.toLowerCase() || 'challenge'} stage.`;
}

function concept(game, theme, mechs, n = 0) {
  const p = theme.palette?.length ? theme.palette : pal(theme.name);
  const names = ['Sort Saga', 'Merge Parade', 'Stack Party', 'Pop & Pour', 'Tidy Quest', 'Jar Jam'];
  const title = `${theme.name.split(' ')[0]} ${names[(hash(theme.name) + n) % names.length]}`;
  return {
    title, tagline: `Sort, merge and decorate the ${theme.name.toLowerCase()} world.`,
    hook: `A one-thumb ${mechs.map((m) => m.name.toLowerCase()).join(' + ')} puzzle where every finished stack bursts into a shiny ${theme.name} collectible.`,
    core_loop: ['Tap a stack to lift its top pieces', 'Pour onto a matching or empty stack', 'Complete a stack of 4 to MERGE it into a star collectible', 'Clear all stacks before moves run out'],
    mechanics_merge: mergeSummary(game, theme, mechs),
    art_direction: `${theme.name}: glossy chunky pieces, soft rim light, palette ${p.join(', ')}, playful UI with rounded pill buttons.`,
    palette: p.slice(0, 5),
    progression: 'Levels add colours and tighter move limits; every 5 levels unlock a new decoration room that uses merged collectibles.',
    monetization: 'Rewarded ads for +5 moves / undo, interstitial every 3 levels, season pass with themed skins, no-ads IAP.',
    controls: 'Tap to select, tap to pour. Works with touch and mouse.',
    win_lose: 'Win: all stacks merged. Lose: out of moves or no legal moves.',
    sprites: [0, 1, 2, 3].map((i) => ({ key: `item${i}`, description: `${theme.name} collectible #${i + 1}` })),
    item_names: [0, 1, 2, 3].map((i) => `${theme.name} piece ${i + 1}`),
    animation_beats: ['Board appears with mixed stacks', 'Finger taps a stack; pieces lift', 'Pieces pour into matching stack', 'Stack completes and merges with sparkles', 'Level clear banner'],
    variant: n,
  };
}

function mockupHtml(c) {
  const p = c.palette;
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
html,body{margin:0;width:390px;height:844px;overflow:hidden;font-family:system-ui,sans-serif;background:linear-gradient(160deg,${p[3] || '#3a2b8c'},#0b0f1e)}
.hud{position:absolute;top:18px;left:14px;right:14px;height:58px;border-radius:18px;background:rgba(0,0,0,.35);color:#fff;display:flex;justify-content:space-around;align-items:center;font-weight:800}
h1{position:absolute;top:96px;width:100%;text-align:center;color:#fff;font-size:30px;margin:0;text-shadow:0 4px 18px ${p[0]}}
.tubes{position:absolute;top:300px;left:0;right:0;display:flex;justify-content:center;gap:16px}
.tube{width:62px;height:250px;border:3px solid rgba(255,255,255,.5);border-radius:28px;background:rgba(255,255,255,.1);position:relative}
.b{width:50px;height:50px;border-radius:50%;position:absolute;left:6px;box-shadow:inset -6px -8px 0 rgba(0,0,0,.2),inset 6px 6px 0 rgba(255,255,255,.35)}
.lift{animation:lift 4s infinite}@keyframes lift{0%,15%{transform:translate(0,0)}25%{transform:translate(0,-80px)}45%{transform:translate(156px,-80px)}55%,100%{transform:translate(156px,-2px)}}
.done{animation:merge 4s infinite}@keyframes merge{0%,55%{transform:scale(1);filter:none}65%{transform:scale(1.25);filter:drop-shadow(0 0 22px ${p[1]})}80%,100%{transform:scale(1);filter:drop-shadow(0 0 10px ${p[1]})}}
.spark{position:absolute;width:10px;height:10px;border-radius:50%;background:${p[1]};opacity:0;animation:sp 4s infinite}@keyframes sp{0%,58%{opacity:0;transform:translate(0,0)}65%{opacity:1}90%,100%{opacity:0;transform:translate(var(--dx),var(--dy))}}
.hand{position:absolute;font-size:44px;animation:hand 4s infinite}@keyframes hand{0%{left:70px;top:600px}20%{left:70px;top:560px}40%{left:230px;top:560px}100%{left:230px;top:600px}}
.banner{position:absolute;top:640px;left:40px;right:40px;padding:16px;border-radius:20px;text-align:center;color:#fff;font-weight:900;font-size:26px;background:linear-gradient(${p[0]},${p[2]});opacity:0;animation:ban 4s infinite}@keyframes ban{0%,78%{opacity:0;transform:scale(.6)}86%,100%{opacity:1;transform:scale(1)}}
</style></head><body><div class="hud"><span>LV 7</span><span>2,450</span><span>Moves 12</span></div><h1>${esc(c.title)}</h1>
<div class="tubes">${[0, 1, 2, 3].map((t) => `<div class="tube ${t === 2 ? 'done' : ''}">${[0, 1, 2, 3].filter((k) => !(t === 2 && k === 3)).map((k) => `<div class="b ${t === 0 && k === 3 ? 'lift' : ''}" style="bottom:${8 + k * 58}px;background:${p[t === 2 ? 1 : (t + k) % 4]}"></div>`).join('')}</div>`).join('')}</div>
${Array.from({ length: 12 }, (_, i) => `<div class="spark" style="left:231px;top:420px;--dx:${Math.round(Math.cos(i / 2) * 90)}px;--dy:${Math.round(Math.sin(i / 2) * 90)}px"></div>`).join('')}
<div class="hand">👆</div><div class="banner">MERGE! +300</div></body></html>`;
}

function assets(c) {
  const p = c.palette;
  const item = (i) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128"><defs><radialGradient id="r" cx=".35" cy=".3" r=".8"><stop offset="0" stop-color="#fff"/><stop offset=".3" stop-color="${p[i % p.length]}"/><stop offset="1" stop-color="#000" stop-opacity=".6"/></radialGradient></defs><circle cx="64" cy="64" r="56" fill="${p[i % p.length]}"/><circle cx="64" cy="64" r="56" fill="url(#r)" opacity=".8"/><text x="64" y="82" font-size="52" text-anchor="middle">${EMO[(i * 5 + hash(c.title)) % EMO.length]}</text></svg>`;
  return {
    background: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 390 844"><defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${p[3] || '#3a2b8c'}"/><stop offset="1" stop-color="#0b0f1e"/></linearGradient></defs><rect width="390" height="844" fill="url(#g)"/>${Array.from({ length: 40 }, (_, i) => `<circle cx="${(i * 97) % 390}" cy="${(i * 211) % 844}" r="${1 + (i % 3)}" fill="#fff" opacity=".4"/>`).join('')}<ellipse cx="195" cy="900" rx="320" ry="200" fill="${p[0]}" opacity=".25"/></svg>`,
    icon: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256"><rect width="256" height="256" rx="56" fill="${p[0]}"/><rect x="16" y="16" width="224" height="224" rx="44" fill="${p[3] || '#3a2b8c'}"/><text x="128" y="160" font-size="110" text-anchor="middle">${EMO[hash(c.title) % EMO.length]}</text></svg>`,
    sprites: Object.fromEntries((c.sprites || []).map((s, i) => [s.key, item(i)])),
  };
}

module.exports = { themes, themeSvg, mergeSummary, concept, mockupHtml, assets };
