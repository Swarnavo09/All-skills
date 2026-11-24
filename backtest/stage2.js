// Stage 2: for every signal family that passed in both periods, sweep a finer exit grid and score robustness.
const fs = require('fs');
const Engine = require('./engine.js');
const S = require('./search.js');
const bars = S.loadBars();
const R = JSON.parse(fs.readFileSync('results/search_stage1.json'));
const good = s => s.n >= 6 && s.rr >= 2 && s.ddPct < 0.10 && s.net > 0 && s.worstDayNoGap >= -8000;
const fam = r => JSON.stringify([r.key.conds, r.key.adxMin || 0, r.key.entry, r.key.dir]);
const fams = [...new Set(R.filter(r => good(r.train) && good(r.test)).map(fam))].map(f => JSON.parse(f));
console.log('families', fams.length);
const out = [];
for (const [conds, adxMin, entry, dir] of fams) {
  let pass = 0, tot = 0, best = null;
  for (const sl of [5000, 6000, 7000, 7600]) for (const rr of [2, 2.5, 3]) for (const be of [0, 1, 1.5])
    for (const mb of [0, 5, 10]) for (const ex of [0, 9, 18]) for (const re of ['reset', 'immediate']) {
      const p = Object.assign(S.baseParams(1), entry, dir, { conds, adxMin: adxMin || 20, rsiLo: 50, rsiHi: 70, stopLoss: sl, targetR: rr, maxBars: mb, emaExit: ex, reentry: re });
      if (be) { p.lockAt = sl * be; p.lockTo = S.cost(1); p.trailStep = 0; p.trailBy = 0; } else p.lockAt = 0;
      const r = Engine.run(bars, p), a = S.periodStats(r, S.TRAIN), b = S.periodStats(r, S.TEST);
      tot++;
      const ok = good(a) && good(b);
      if (ok) { pass++; const score = Math.min(a.win, b.win) * 2 + (a.net + b.net) / 2e5; if (!best || score > best.score) best = { score, sl, rr, be, mb, ex, re, a, b }; }
    }
  out.push({ conds, adxMin, entry, dir, passFrac: pass / tot, best });
}
out.sort((x, y) => y.passFrac - x.passFrac);
fs.writeFileSync('results/search_stage2.json', JSON.stringify(out));
const d = x => `${x.conds.join('+')} | ${x.entry.entryMode}${x.entry.limitAtr || ''} | ${x.dir.allowLong && x.dir.allowShort ? 'both' : x.dir.allowLong ? 'long' : 'short'}`;
const s = x => `n${x.n} w${(x.win * 100).toFixed(0)}% rr${x.rr.toFixed(1)} net${x.net} dd${(x.ddPct * 100).toFixed(1)}%`;
out.slice(0, 20).forEach(x => console.log((x.passFrac * 100).toFixed(0) + '%', d(x), x.adxMin ? 'adx' + x.adxMin : '', '\n    best:', JSON.stringify({ sl: x.best.sl, rr: x.best.rr, be: x.best.be, mb: x.best.mb, ex: x.best.ex, re: x.best.re }), 'TRAIN', s(x.best.a), '| TEST', s(x.best.b)));
