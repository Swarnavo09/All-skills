// Brute-force search over entry-condition subsets, filters, entry type, direction and risk/exit settings.
// One backtest per config over the full window; stats are then split into TRAIN and TEST periods.
// node search.js [stage=1]  -> results/search_stage1.json
const fs = require('fs'), path = require('path');
const { Worker, isMainThread, parentPort, workerData } = require('worker_threads');
const Engine = require('./engine.js');

const TRAIN = ['2025-01-01', '2025-11-21'], TEST = ['2025-11-24', '2026-11-23'];
const LOT = 65, DAY_LIMIT = 8000;

function loadBars() {
  return fs.readFileSync(path.join(__dirname, 'data/nifty50_daily.csv'), 'utf8').trim().split('\n').slice(1)
    .map(l => { const [date, o, h, lo, c, v] = l.split(','); return { date, o: +o, h: +h, l: +lo, c: +c, v: +v }; });
}
const cost = lots => 100 + 300 * lots;
function baseParams(lots) {
  return { startDate: TRAIN[0], endDate: TEST[1], lots, lotSizeOld: LOT, lotSizeNew: LOT, costPerTrade: cost(lots), rollCost: cost(lots), capital: 200000 * lots };
}
function periodStats(r, [from, to]) {
  const t = r.trades.filter(x => x.entryDate >= from && x.entryDate <= to);
  const eq = r.equity.filter(e => e.date >= from && e.date <= to);
  const startEq = (r.equity.filter(e => e.date < from).pop() || { equity: 0 }).equity;
  let peak = startEq, dd = 0; eq.forEach(e => { peak = Math.max(peak, e.equity); dd = Math.max(dd, peak - e.equity); });
  const wins = t.filter(x => x.net > 0), losses = t.filter(x => x.net <= 0);
  const aw = wins.length ? wins.reduce((a, x) => a + x.net, 0) / wins.length : 0;
  const al = losses.length ? losses.reduce((a, x) => a + x.net, 0) / losses.length : 0;
  const net = t.reduce((a, x) => a + x.net, 0);
  const worstDayNoGap = Math.min(0, ...Object.values(t.filter(x => !x.gap).reduce((m, x) => (m[x.exitDate] = (m[x.exitDate] || 0) + x.net, m), {})));
  return { n: t.length, wins: wins.length, win: t.length ? wins.length / t.length : 0, net: Math.round(net), dd: Math.round(dd),
    ddPct: dd / r.params.capital, rr: al ? aw / -al : (aw ? 99 : 0), minWin: wins.length ? Math.min(...wins.map(x => x.net)) : 0,
    aw: Math.round(aw), al: Math.round(al), worstDayNoGap: Math.round(worstDayNoGap) };
}

// ---------- grid ----------
function subsets(arr) { const out = []; for (let m = 1; m < 1 << arr.length; m++) out.push(arr.filter((_, i) => m & (1 << i))); return out; }
const EXTRAS = [[], ['adx20'], ['adx25'], ['rsi']];
const ENTRIES = [{ entryMode: 'nextOpen' }, { entryMode: 'close' }, { entryMode: 'limit', limitAtr: 0.25 }, { entryMode: 'limit', limitAtr: 0.5 }];
const DIRS = [{ allowLong: true, allowShort: true }, { allowLong: true, allowShort: false }, { allowLong: false, allowShort: true }];
const RISK = [{ lots: 1, stopLoss: 4000 }, { lots: 1, stopLoss: 5500 }, { lots: 1, stopLoss: 7600 }, { lots: 2, stopLoss: 7300 }];
const RR = [2, 3];
const TRAIL = ['none', 'be'];
const MAXB = [0, 5];
const EMAX = [0, 18];

function signalConfigs() {
  const out = [];
  subsets(Engine.ALL_CONDS).forEach(cs => EXTRAS.forEach(ex => out.push({ cs, ex })));
  return out;
}
function makeParams(sig, entry, dir, risk, rr, trail, maxBars, emaExit) {
  const conds = sig.cs.slice(); const extra = {};
  sig.ex.forEach(e => { if (e.startsWith('adx')) { conds.push('adx'); extra.adxMin = +e.slice(3); } if (e === 'rsi') { conds.push('rsi'); extra.rsiLo = 50; extra.rsiHi = 70; } });
  const p = Object.assign(baseParams(risk.lots), entry, dir, extra, { conds, stopLoss: risk.stopLoss, targetR: rr, maxBars, emaExit, reentry: 'reset' });
  if (trail === 'none') p.lockAt = 0;
  else { p.lockAt = risk.stopLoss; p.lockTo = cost(risk.lots); p.trailStep = 0; p.trailBy = 0; }   // breakeven (net ~0) once +1R
  return p;
}
function* grid(sigs) {
  for (const sig of sigs) for (const entry of ENTRIES) for (const dir of DIRS) for (const risk of RISK)
    for (const rr of RR) for (const trail of TRAIL) for (const mb of MAXB) for (const ex of EMAX)
      yield { sig, entry, dir, risk, rr, trail, mb, ex };
}
function evaluate(bars, g) {
  const p = makeParams(g.sig, g.entry, g.dir, g.risk, g.rr, g.trail, g.mb, g.ex);
  const r = Engine.run(bars, p);
  return { key: { conds: p.conds, adxMin: p.adxMin, rsi: !!g.sig.ex.includes('rsi'), entry: g.entry, dir: g.dir, lots: g.risk.lots, stopLoss: g.risk.stopLoss, targetR: g.rr, trail: g.trail, maxBars: g.mb, emaExit: g.ex },
    train: periodStats(r, TRAIN), test: periodStats(r, TEST) };
}

if (isMainThread && require.main === module) {
  const sigs = signalConfigs(), W = 4, t0 = Date.now();
  let done = 0, results = [];
  const chunks = Array.from({ length: W }, (_, k) => sigs.filter((_, i) => i % W === k));
  chunks.forEach((c, k) => {
    const w = new Worker(__filename, { workerData: c });
    w.on('message', m => { results = results.concat(m.keep); done++; console.log(`worker ${k} done: ${m.total} runs, kept ${m.keep.length}`);
      if (done === W) {
        fs.mkdirSync(path.join(__dirname, 'results'), { recursive: true });
        fs.writeFileSync(path.join(__dirname, 'results/search_stage1.json'), JSON.stringify(results));
        console.log('total kept', results.length, 'in', ((Date.now() - t0) / 1000).toFixed(0), 's');
      } });
  });
} else if (!isMainThread) {
  const bars = loadBars(); let total = 0; const keep = [];
  for (const g of grid(workerData)) {
    total++;
    const r = evaluate(bars, g);
    // keep anything that is at least promising on TRAIN (final filter is applied later)
    if (r.train.n >= 5 && r.train.win >= 0.5 && r.train.net > 0) keep.push(r);
  }
  parentPort.postMessage({ total, keep });
}
module.exports = { loadBars, periodStats, baseParams, makeParams, TRAIN, TEST, cost };
