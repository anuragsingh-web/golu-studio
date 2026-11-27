#!/usr/bin/env node
// Nightly (or manual) autopilot. Reuses the studio pipeline; see lib/autopilot.js.
//
//   npm run autopilot -- --count 20 --threshold 7
//   MOCK=1 npm run autopilot -- --count 4          # offline, no Cursor key
//   npm run autopilot -- --plan                    # print the combo queue and exit
//   npm run autopilot -- --check                   # score the mock judge, no Chrome
const path = require('path');
require('../lib/env').loadEnv(path.join(__dirname, '..'));

function parseArgs(argv) {
  const o = {
    count: Number(process.env.AUTOPILOT_COUNT || 20),
    threshold: process.env.AUTOPILOT_THRESHOLD != null && process.env.AUTOPILOT_THRESHOLD !== '' ? Number(process.env.AUTOPILOT_THRESHOLD) : 7,
    parallel: Number(process.env.AUTOPILOT_PARALLEL || 2),
    timeoutMin: Number(process.env.AUTOPILOT_GAME_TIMEOUT_MIN || 30),
    planOnly: false,
    check: false,
    mock: process.env.MOCK === '1',
    help: false,
    seed: process.env.AUTOPILOT_SEED || '',
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--count') o.count = Number(argv[++i]);
    else if (a === '--threshold') o.threshold = Number(argv[++i]);
    else if (a === '--parallel') o.parallel = Number(argv[++i]);
    else if (a === '--timeout-min') o.timeoutMin = Number(argv[++i]);
    else if (a === '--seed') o.seed = argv[++i];
    else if (a === '--plan') o.planOnly = true;
    else if (a === '--check') o.check = true;
    else if (a === '--mock') o.mock = true;
    else if (a === '--help' || a === '-h') o.help = true;
    else { console.error(`Unknown argument: ${a}`); o.help = true; }
  }
  return o;
}

function help() {
  console.log(`Usage: npm run autopilot -- [options]

  --count N          combinations to try (default 20, or AUTOPILOT_COUNT)
  --threshold N      keep games scoring >= N (default 7)
  --parallel N       games in flight at once (default 2)
  --timeout-min N    give up on one game after N minutes (default 30)
  --mock             offline demo, no AI key (or set MOCK=1)
  --plan             print tonight's queue and exit
  --check            assert the offline judge keeps some games and drops others
  --seed TEXT        change which combos sort first (default: today's date in IST)
`);
}

async function check() {
  process.env.MOCK = '1';
  const { readRatings } = require('../lib/data');
  const { planCombos } = require('../lib/taste');
  const { mockJudgement, applyJudgement, v2Catalogue } = require('../lib/autopilot-rate');
  const { games } = readRatings();
  const plan = planCombos({ games, history: { combos: {} }, count: 8, seed: 'check' });
  if (plan.combos.length < 4) throw new Error(`expected a full queue, got ${plan.combos.length}`);
  const cat = v2Catalogue().games;
  if (cat.length < 20) throw new Error('Pintu catalogue is too small to score against');
  let hi = 0;
  let lo = 0;
  for (const c of plan.combos.slice(0, 8)) {
    const theme = { name: 'Check Theme', description: 'offline check' };
    const j = mockJudgement({ ...c, theme }, cat);
    const applied = applyJudgement(j, cat);
    const mark = applied.score.overall >= 7 ? 'KEEP' : 'drop';
    console.log(`${mark}  ${applied.score.overall.toFixed(1)}  ${j._profile.padEnd(6)}  ${c.game.overall_score.toFixed(1)}  ${c.game.name}  + ${c.mechKey}`);
    if (applied.score.overall >= 7) hi += 1;
    else lo += 1;
  }
  if (!hi || !lo) throw new Error(`offline judge should both keep and drop games in the sample (kept ${hi}, dropped ${lo})`);
  console.log(`check ok: ${hi} would be kept, ${lo} dropped`);
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) { help(); process.exit(0); }
  if (opts.mock) process.env.MOCK = '1';
  if (opts.check) {
    await check();
    return;
  }
  if (opts.planOnly) {
    require('../lib/autopilot').printPlan(opts);
    return;
  }
  if (process.env.H5_FIX_ROUNDS == null || process.env.H5_FIX_ROUNDS === '') process.env.H5_FIX_ROUNDS = '1';
  const { runAutopilot } = require('../lib/autopilot');
  try {
    await runAutopilot(opts);
  } catch (e) {
    console.error(`\n${e.message}`);
    process.exit(e.status && e.status < 10 ? e.status : 1);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
