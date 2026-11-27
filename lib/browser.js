// Headless Chromium helpers (puppeteer-core + an installed Chrome/Edge/Chromium).
// Set CHROME_PATH to point at a browser binary if auto-detection fails.
const fs = require('fs');

const CANDIDATES = [
  process.env.CHROME_PATH,
  // Windows
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  process.env.LOCALAPPDATA && `${process.env.LOCALAPPDATA}\\Google\\Chrome\\Application\\chrome.exe`,
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  // macOS
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
  // Linux
  '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser',
  '/snap/bin/chromium', '/usr/bin/microsoft-edge',
].filter(Boolean);

function chromePath() { return CANDIDATES.find((p) => { try { return fs.existsSync(p); } catch { return false; } }) || null; }

let browserP = null;
async function getBrowser() {
  if (browserP) { const b = await browserP.catch(() => null); if (b && b.connected) return b; }
  const exe = chromePath();
  if (!exe) throw new Error('No Chrome/Edge/Chromium found for headless rendering. Install Chrome or set CHROME_PATH in .env.');
  const puppeteer = require('puppeteer-core');
  browserP = puppeteer.launch({ executablePath: exe, headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage', '--autoplay-policy=no-user-gesture-required', '--hide-scrollbars'] });
  return browserP;
}

async function withPage(fn, viewport = { width: 390, height: 844, deviceScaleFactor: 1, isMobile: true, hasTouch: true }) {
  const b = await getBrowser();
  const page = await b.newPage();
  try { await page.setViewport(viewport); return await fn(page); } finally { await page.close().catch(() => {}); }
}

// Capture N frames from an animated page (mockup HTML) over durationMs.
async function captureFrames(url, { frames = 16, durationMs = 4000, width = 390, height = 844, settleMs = 600 } = {}) {
  return withPage(async (page) => {
    await page.goto(url, { waitUntil: 'load', timeout: 30000 });
    await new Promise((r) => setTimeout(r, settleMs));
    const out = [];
    const step = durationMs / frames;
    for (let i = 0; i < frames; i++) {
      const t0 = Date.now();
      out.push(await page.screenshot({ type: 'png' }));
      const wait = step - (Date.now() - t0);
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    }
    return out;
  }, { width, height, deviceScaleFactor: 1, isMobile: false, hasTouch: false });
}

async function screenshot(url, { width = 390, height = 844, waitMs = 1200, fullPage = false } = {}) {
  return withPage(async (page) => {
    await page.goto(url, { waitUntil: 'load', timeout: 30000 });
    await new Promise((r) => setTimeout(r, waitMs));
    return page.screenshot({ type: 'png', fullPage });
  }, { width, height, deviceScaleFactor: 1, isMobile: false, hasTouch: false });
}

// Load a generated game, play-poke it and collect runtime errors.
async function validateGame(url) {
  return withPage(async (page) => {
    const errors = [];
    page.on('pageerror', (e) => errors.push(`Uncaught: ${e.message}`));
    page.on('console', (m) => { if (m.type() === 'error' && !/favicon|AudioContext|autoplay|Failed to load resource/i.test(m.text())) errors.push(`console.error: ${m.text()}`); });
    page.on('response', (r) => { if (r.status() >= 400 && !/favicon/.test(r.url())) errors.push(`HTTP ${r.status()} loading ${r.url().slice(0, 120)}`); });
    page.on('requestfailed', (r) => { if (!/favicon/.test(r.url())) errors.push(`Request failed: ${r.url().slice(0, 120)} (${r.failure()?.errorText})`); });
    await page.goto(url, { waitUntil: 'load', timeout: 30000 });
    await new Promise((r) => setTimeout(r, 1500));
    const start = await page.screenshot({ type: 'png' });
    const vp = page.viewport();
    // Tap through the start screen and poke the play-field with taps and a drag.
    const pts = [[0.5, 0.5], [0.5, 0.75], [0.5, 0.6], [0.3, 0.55], [0.7, 0.55], [0.5, 0.45], [0.25, 0.7], [0.75, 0.7], [0.5, 0.85]];
    for (const [x, y] of pts) {
      await page.mouse.click(vp.width * x, vp.height * y).catch(() => {});
      await new Promise((r) => setTimeout(r, 250));
    }
    try { await page.touchscreen.tap(vp.width * 0.5, vp.height * 0.62); } catch {}
    await page.mouse.move(vp.width * 0.3, vp.height * 0.6); await page.mouse.down();
    await page.mouse.move(vp.width * 0.7, vp.height * 0.6, { steps: 8 }); await page.mouse.up();
    await new Promise((r) => setTimeout(r, 1500));
    const play = await page.screenshot({ type: 'png' });
    const info = await page.evaluate(() => ({
      canvases: document.querySelectorAll('canvas').length,
      bodyText: (document.body?.innerText || '').slice(0, 200),
      elements: document.body ? document.body.querySelectorAll('*').length : 0,
    }));
    const sharp = require('sharp');
    const st = await sharp(play).stats();
    const variance = st.channels.slice(0, 3).reduce((a, c) => a + c.stdev, 0) / 3;
    if (variance < 3) errors.push('Rendered screen is blank/uniform after interaction (nothing visible drawn).');
    if (!info.canvases && info.elements < 5) errors.push('No canvas or game DOM found.');
    return { ok: errors.length === 0, errors: [...new Set(errors)].slice(0, 15), info, startShot: start, playShot: play };
  });
}

// Load a built game, tap and drag a little, and return several screenshots plus the same
// blank-screen / crash checks as validateGame. Used by the nightly rater; validateGame is unchanged.
async function capturePlay(url, { frames = 8 } = {}) {
  return withPage(async (page) => {
    const errors = [];
    page.on('pageerror', (e) => errors.push(`Uncaught: ${e.message}`));
    page.on('console', (m) => { if (m.type() === 'error' && !/favicon|AudioContext|autoplay|Failed to load resource/i.test(m.text())) errors.push(`console.error: ${m.text()}`); });
    page.on('requestfailed', (r) => { if (!/favicon/.test(r.url())) errors.push(`Request failed: ${r.url().slice(0, 120)} (${r.failure()?.errorText})`); });
    await page.goto(url, { waitUntil: 'load', timeout: 30000 });
    await new Promise((r) => setTimeout(r, 700));
    const shots = [];
    const vp = page.viewport();
    // Title-screen PLAY buttons on these builds sit around 65–72% down; then poke the board.
    const pts = [[0.5, 0.68], [0.5, 0.72], [0.5, 0.62], [0.5, 0.5], [0.32, 0.58], [0.68, 0.58], [0.4, 0.7], [0.6, 0.48], [0.5, 0.78], [0.25, 0.64]];
    shots.push(await page.screenshot({ type: 'png' }));
    for (let i = 0; i < frames; i++) {
      const [x, y] = pts[i % pts.length];
      await page.mouse.click(vp.width * x, vp.height * y).catch(() => {});
      await new Promise((r) => setTimeout(r, 220));
      if (i % 2 === 1) shots.push(await page.screenshot({ type: 'png' }));
    }
    await page.mouse.move(vp.width * 0.32, vp.height * 0.58);
    await page.mouse.down();
    await page.mouse.move(vp.width * 0.7, vp.height * 0.58, { steps: 6 });
    await page.mouse.up();
    await new Promise((r) => setTimeout(r, 350));
    shots.push(await page.screenshot({ type: 'png' }));
    const play = shots[shots.length - 1];
    const sharp = require('sharp');
    const st = await sharp(play).stats();
    const variance = st.channels.slice(0, 3).reduce((a, c) => a + c.stdev, 0) / 3;
    if (variance < 3) errors.push('Rendered screen is blank/uniform after interaction (nothing visible drawn).');
    const info = await page.evaluate(() => ({
      canvases: document.querySelectorAll('canvas').length,
      bodyText: (document.body?.innerText || '').slice(0, 200),
      elements: document.body ? document.body.querySelectorAll('*').length : 0,
    }));
    if (!info.canvases && info.elements < 5) errors.push('No canvas or game DOM found.');
    return { ok: errors.length === 0, errors: [...new Set(errors)].slice(0, 15), info, shots, variance };
  });
}

async function closeBrowser() { if (browserP) { const b = await browserP.catch(() => null); browserP = null; await b?.close().catch(() => {}); } }

module.exports = { chromePath, captureFrames, screenshot, validateGame, capturePlay, closeBrowser, withPage };
