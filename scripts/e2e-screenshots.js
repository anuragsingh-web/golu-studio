#!/usr/bin/env node
// End-to-end UI test: drives the running app in headless Chrome and saves screenshots to ./screenshots.
// Usage: (server running) BASE=http://localhost:5173 node scripts/e2e-screenshots.js [--mock]
const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer-core');
const { chromePath } = require('../lib/browser');
const BASE = process.env.BASE || 'http://localhost:5173';
const MOCK = process.argv.includes('--mock');
const OUT = process.env.OUT || path.join(__dirname, '..', 'screenshots');
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const b = await puppeteer.launch({ executablePath: chromePath(), headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const p = await b.newPage();
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  await p.setViewport({ width: 1440, height: 1000 });
  await p.goto(BASE, { waitUntil: 'networkidle0' });
  if (MOCK) { await p.evaluate(() => localStorage.setItem('golu.settings', JSON.stringify({ mock: true }))); await p.reload({ waitUntil: 'networkidle0' }); }
  await sleep(1500);
  await p.screenshot({ path: path.join(OUT, '01-home.png') });
  await p.screenshot({ path: path.join(OUT, '01-home-full.png'), fullPage: true });
  console.log('home ok');
  await p.click('.podium .p1 .tile');
  await p.waitForSelector('#themes .card', { timeout: 120000 });
  await p.waitForFunction(() => document.querySelectorAll('#themes .thumb img').length >= 3, { timeout: 300000 });
  await p.click('#themes .card:nth-child(4)');
  await p.evaluate(() => { const want = ['sorting', 'merge']; document.querySelectorAll('#mechs .mech').forEach((c) => { if (want.includes(c.dataset.id)) c.click(); }); });
  await p.waitForFunction(() => { const t = document.querySelector('#mergeTxt'); return t && !t.classList.contains('typing') && t.textContent.length > 20; }, { timeout: 120000 });
  await p.evaluate(() => document.querySelector('#stepTheme').scrollIntoView());
  await sleep(500);
  await p.screenshot({ path: path.join(OUT, '02-detail-themes.png') });
  await p.evaluate(() => document.querySelector('#merge').scrollIntoView({ block: 'end' }));
  await sleep(600);
  await p.screenshot({ path: path.join(OUT, '03-detail-mechanics-merge.png') });
  console.log('detail ok');
  await p.click('#genBtn');
  await sleep(2500);
  await p.screenshot({ path: path.join(OUT, '04-generating.png') });
  await p.waitForSelector('#idea .concept', { timeout: 900000 });
  await sleep(2500);
  await p.evaluate(() => document.querySelector('#stepIdea').scrollIntoView());
  await sleep(500);
  await p.screenshot({ path: path.join(OUT, '05-mockup-idea.png') });
  const ideaTitle = await p.$eval('#idea .concept h2', (e) => e.textContent);
  console.log('idea ok:', ideaTitle);
  await p.click('#h5Btn');
  await p.waitForSelector('#h5 .h5wrap', { timeout: 1800000 });
  await sleep(4000);
  await p.evaluate(() => document.querySelector('#stepH5').scrollIntoView());
  await sleep(800);
  await p.screenshot({ path: path.join(OUT, '06-h5-in-app.png') });
  const url = await p.$eval('#h5 iframe', (f) => f.getAttribute('src'));
  const status = await p.$eval('#h5 .okbox, #h5 .err', (e) => e.textContent).catch(() => '?');
  console.log('h5:', url, '|', status.trim());
  // Play the generated game standalone at phone size
  const g = await b.newPage();
  await g.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
  await g.goto(BASE + url, { waitUntil: 'load' });
  await sleep(1500);
  await g.screenshot({ path: path.join(OUT, '07-game-start.png') });
  await g.mouse.click(195, 592); await sleep(1200);
  for (const [x, y] of [[60, 450], [270, 450], [130, 450], [340, 450]]) { await g.mouse.click(x, y); await sleep(400); }
  await sleep(800);
  await g.screenshot({ path: path.join(OUT, '08-game-play.png') });
  console.log('page errors:', errs.length ? errs : 'none');
  await b.close();
})().catch((e) => { console.error('E2E FAILED:', e.message); process.exit(1); });
