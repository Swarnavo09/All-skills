// Combine the robust short rule family with candidate long rule families (one position at a time).
const fs = require('fs');
const Engine = require('./engine.js'), S = require('./search.js');
const bars = S.loadBars();
const st = x => `n${x.n} w${(x.win * 100).toFixed(0)}% rr${x.rr.toFixed(1)} net${x.net} dd${(x.ddPct * 100).toFixed(1)}% wd${x.worstDayNoGap}`;
const good = s => s.n >= 8 && s.rr >= 2 && s.ddPct < 0.10 && s.net > 0 && s.worstDayNoGap >= -8000;
const LONGS = {
  none: null,
  L1_e9_21_pullback: { conds: ['e9_21'], entryMode: 'limit', limitAtr: 0.25 },
  L1b_e9_21_e18_42_pullback: { conds: ['e9_21', 'e18_42'], entryMode: 'limit', limitAtr: 0.25 },
  L1c_st_e9_21_pullback: { conds: ['st', 'e9_21'], entryMode: 'limit', limitAtr: 0.25 },
  L2_ema21_adx20_close: { conds: ['ema21', 'adx'], adxMin: 20, entryMode: 'close' },
  L3_ema21_open: { conds: ['ema21'], entryMode: 'nextOpen' },
};
const rows = [];
for (const [lname, L] of Object.entries(LONGS))
  for (const ssl of [6000, 7000, 7600]) for (const srr of [2.5, 3]) for (const smb of [3, 5, 10])
    for (const lsl of (L ? [5500, 7000, 7600] : [0])) for (const lrr of (L ? [2, 2.5, 3] : [0])) for (const lbe of (L ? [0, 1] : [0])) for (const lex of (L ? [0, 9, 18] : [0]))
      for (const re of ['immediate', 'reset']) {
        const short = { conds: ['st', 'day', 'week', 'rsi'], rsiLo: 50, rsiHi: 70, entryMode: 'close', stopLoss: ssl, targetR: srr, maxBars: smb, emaExit: 9, lockAt: 0 };
        const p = Object.assign(S.baseParams(1), { reentry: re, allowLong: !!L, allowShort: true, short });
        if (L) p.long = Object.assign({}, L, { stopLoss: lsl, targetR: lrr, maxBars: 0, emaExit: lex, lockAt: lbe ? lsl : 0, lockTo: S.cost(1), trailStep: 0, trailBy: 0 });
        const r = Engine.run(bars, p), a = S.periodStats(r, S.TRAIN), b = S.periodStats(r, S.TEST);
        rows.push({ lname, ssl, srr, smb, lsl, lrr, lbe, lex, re, a, b, ok: good(a) && good(b) });
      }
const byL = {};
rows.forEach(r => { const k = r.lname; (byL[k] = byL[k] || { tot: 0, ok: 0, best: null }); byL[k].tot++; if (r.ok) { byL[k].ok++; const sc = Math.min(r.a.win, r.b.win) + (r.a.net + r.b.net) / 1e6; if (!byL[k].best || sc > byL[k].best.sc) byL[k].best = Object.assign({ sc }, r); } });
Object.entries(byL).forEach(([k, v]) => { console.log(k, `pass ${v.ok}/${v.tot} (${(100 * v.ok / v.tot).toFixed(0)}%)`); if (v.best) { const b = v.best; console.log('   best', JSON.stringify({ ssl: b.ssl, srr: b.srr, smb: b.smb, lsl: b.lsl, lrr: b.lrr, lbe: b.lbe, lex: b.lex, re: b.re }), '\n   TRAIN', st(b.a), '| TEST', st(b.b)); } });
fs.writeFileSync('results/combo.json', JSON.stringify(rows));
