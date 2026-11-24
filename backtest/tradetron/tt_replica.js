// Daily-candle replica of Tradetron "NIFTY Futures Weekly v2" (template 999498586) on NSE bhavcopy data.
// The real strategy runs on 1-hour NIFTY futures candles; bhavcopy only has daily index candles, so:
//   "previous 1H candle" -> previous daily candle;  entry "LTP breaks prev candle high/low" -> today's high/low breaks yesterday's
//   1H session VWAP -> yesterday's typical price (H+L+C)/3 (a one-candle session VWAP);  SMA18 exit on 1H close -> daily close
//   10:00-12:00 entry window -> cannot be checked on daily bars (assumed to happen in the window)
// node tradetron/tt_replica.js [--json out.json]
const fs = require('fs'), path = require('path');
const E = require('../engine.js');

const P = {
  start: '2024-10-17', end: '2026-10-17', qty: 130,             // 2 lots x 65, as in the Tradetron run
  maxProfit: 40000, maxLoss: 8000, tslAt: 16000, tslStep: 1600, tslBy: 1600,   // TSL: cost at +16K, then +1.6K per +1.6K
  costPerTrade: 126,                                            // Tradetron run: Rs 5,050 costs over 40 positions
  stAtrMode: process.argv.includes('--rma') ? 'rma' : 'sma',     // 'ST SMA' = Supertrend on an SMA-based ATR
  vwapMode: process.argv.includes('--weekly-vwap') ? 'weekly' : 'daily',
};

const bars = fs.readFileSync(path.join(__dirname, '../data/nifty50_daily.csv'), 'utf8').trim().split('\n').slice(1)
  .map(l => { const [date, o, h, lo, c, v] = l.split(','); return { date, o: +o, h: +h, l: +lo, c: +c, v: +v }; });
const n = bars.length, C = bars.map(b => b.c);
const sma = (src, k) => src.map((_, i) => i < k - 1 ? NaN : src.slice(i - k + 1, i + 1).reduce((a, x) => a + x, 0) / k);
const e9 = E.ema(C, 9), e21 = E.ema(C, 21), e18 = E.ema(C, 18), e42 = E.ema(C, 42), s18 = sma(C, 18);

function supertrend(period, mult, mode) {
  const tr = bars.map((b, i) => i ? Math.max(b.h - b.l, Math.abs(b.h - bars[i - 1].c), Math.abs(b.l - bars[i - 1].c)) : b.h - b.l);
  const atr = mode === 'sma' ? sma(tr, period) : (() => { const o = new Array(n).fill(NaN); for (let i = period - 1; i < n; i++) o[i] = i === period - 1 ? tr.slice(0, period).reduce((a, x) => a + x, 0) / period : (o[i - 1] * (period - 1) + tr[i]) / period; return o; })();
  const line = new Array(n).fill(NaN); let up = NaN, dn = NaN, trend = 1;
  for (let i = 0; i < n; i++) {
    if (isNaN(atr[i])) continue;
    const hl2 = (bars[i].h + bars[i].l) / 2; let u = hl2 - mult * atr[i], d = hl2 + mult * atr[i];
    if (!isNaN(up)) { const pc = bars[i - 1].c; u = pc > up ? Math.max(u, up) : u; d = pc < dn ? Math.min(d, dn) : d;
      if (trend === -1 && bars[i].c > dn) trend = 1; else if (trend === 1 && bars[i].c < up) trend = -1; }
    up = u; dn = d; line[i] = trend === 1 ? up : dn;
  }
  return line;
}
const st = supertrend(10, 3, P.stAtrMode);
const vwap = P.vwapMode === 'daily' ? bars.map(b => (b.h + b.l + b.c) / 3) : (() => {
  const out = []; let key = null, pv = 0, vv = 0;
  bars.forEach(b => { const d = new Date(b.date + 'T00:00:00Z'); const k = Math.floor((d - Date.UTC(1970, 0, 5)) / (7 * 864e5)); if (k !== key) { key = k; pv = 0; vv = 0; } pv += (b.h + b.l + b.c) / 3 * b.v; vv += b.v; out.push(pv / vv); });
  return out; })();

// weekly expiry: Thursday until Aug-2025, Tuesday from Sep-2025; holiday -> previous trading day
const dates = new Set(bars.map(b => b.date));
function weeklyExpiryOnOrAfter(dateStr) {
  const d = new Date(dateStr + 'T00:00:00Z');
  for (let k = 0; k < 14; k++) {
    const c = new Date(d.getTime() + k * 864e5), s = c.toISOString().slice(0, 10);
    const tue = s >= '2025-09-01';
    if (c.getUTCDay() === (tue ? 2 : 4)) {
      let e = new Date(c); let es = s;
      while (!dates.has(es) && es <= bars[n - 1].date) { e = new Date(e.getTime() - 864e5); es = e.toISOString().slice(0, 10); }
      if (es >= dateStr) return es;
    }
  }
  return null;
}
const dow = s => new Date(s + 'T00:00:00Z').getUTCDay();   // 4 = Thu, 5 = Fri

const trades = [];
let pos = null;
const stopPnl = m => m >= P.tslAt ? Math.floor((m - P.tslAt) / P.tslStep) * P.tslBy : -P.maxLoss;
function close(i, px, why) {
  const pnl = pos.dir * (px - pos.entry) * P.qty;
  trades.push({ side: pos.dir > 0 ? 'LONG' : 'SHORT', entryDate: pos.date, entry: +pos.entry.toFixed(2), exitDate: bars[i].date, exit: +px.toFixed(2),
    gross: Math.round(pnl), net: Math.round(pnl - P.costPerTrade), reason: why });
  pos = null;
}
for (let i = 1; i < n; i++) {
  const b = bars[i], y = i - 1;
  if (b.date < P.start || b.date > P.end) continue;
  const expiry = weeklyExpiryOnOrAfter(b.date);
  // ---- manage open position (stop/target/TSL intrabar, adverse first; SMA18 + expiry square-off at close)
  if (pos && pos.idx < i) {
    const d = pos.dir, px = pnl => pos.entry + d * pnl / P.qty, mtm = x => d * (x - pos.entry) * P.qty;
    const fav = d > 0 ? b.h : b.l, adv = d > 0 ? b.l : b.h, beyond = (x, lv, f) => f ? d * (x - lv) >= 0 : d * (x - lv) <= 0;
    const sPx = px(pos.stop), tPx = px(P.maxProfit);
    if (beyond(b.o, sPx, false)) close(i, b.o, pos.stop > -P.maxLoss ? 'TSL (gap)' : 'Stop-loss (gap)');
    else if (beyond(b.o, tPx, true)) close(i, b.o, 'Take-profit (gap)');
    else if (beyond(adv, sPx, false)) close(i, sPx, pos.stop > -P.maxLoss ? 'TSL' : 'Stop-loss');
    else if (beyond(fav, tPx, true)) close(i, tPx, 'Take-profit');
    else {
      pos.max = Math.max(pos.max, mtm(fav)); const ns = Math.max(pos.stop, stopPnl(pos.max));
      if (ns > pos.stop && beyond(b.c, px(ns), false)) close(i, px(ns), 'TSL'); else pos.stop = ns;
      if (pos && d * (C[y] - s18[y]) < 0) close(i, b.o, 'Set exit (SMA18)');   // prev close crossed SMA18 -> out at today's open
      if (pos && b.date === expiry) close(i, b.c, 'Expiry square-off');
    }
  }
  // ---- entry: Thu (long or short) / Fri (short only), not on expiry day, prev candle conditions + break of prev high/low
  if (!pos && expiry && b.date < expiry) {
    const wd = dow(b.date);
    for (const d of [1, -1]) {
      if (pos) break;
      if (d > 0 && wd !== 4) continue;
      if (d < 0 && wd !== 4 && wd !== 5) continue;
      const ok = d * (C[y] - st[y]) > 0 && d * (C[y] - e21[y]) > 0 && d * (e9[y] - e21[y]) > 0 && d * (e18[y] - e42[y]) > 0 && d * (C[y] - vwap[y]) > 0;
      if (!ok) continue;
      const lvl = d > 0 ? bars[y].h : bars[y].l;
      const hit = d > 0 ? b.h > lvl : b.l < lvl;
      if (!hit) continue;
      const entry = d > 0 ? Math.max(b.o, lvl) : Math.min(b.o, lvl);
      pos = { dir: d, entry, date: b.date, idx: i, max: 0, stop: -P.maxLoss };
      // same-day management after an intrabar fill: adverse move after the fill vs stop, close-based favourable
      const px = pnl => entry + d * pnl / P.qty, adv = d > 0 ? b.l : b.h;
      if (entry !== b.o ? false : d * (adv - px(-P.maxLoss)) <= 0) close(i, px(-P.maxLoss), 'Stop-loss');
      else if (entry !== b.o && d * (b.c - px(-P.maxLoss)) <= 0) close(i, px(-P.maxLoss), 'Stop-loss');
      else if (d * (b.c - px(P.maxProfit)) >= 0) close(i, px(P.maxProfit), 'Take-profit');
      else if (pos) { pos.max = Math.max(0, d * (b.c - entry) * P.qty); pos.stop = stopPnl(pos.max); }
    }
  }
}
if (pos) close(n - 1, bars[n - 1].c, 'Open at end');

const net = trades.reduce((a, t) => a + t.net, 0), wins = trades.filter(t => t.net > 0);
let eq = 0, peak = 0, dd = 0; trades.forEach(t => { eq += t.net; peak = Math.max(peak, eq); dd = Math.max(dd, peak - eq); });
const summary = { settings: P, positions: trades.length, wins: wins.length, winRate: trades.length ? wins.length / trades.length : 0, net,
  avgWin: wins.length ? wins.reduce((a, t) => a + t.net, 0) / wins.length : 0,
  avgLoss: trades.length - wins.length ? trades.filter(t => t.net <= 0).reduce((a, t) => a + t.net, 0) / (trades.length - wins.length) : 0, maxDDClosed: dd,
  long: trades.filter(t => t.side === 'LONG').reduce((a, t) => a + t.net, 0), short: trades.filter(t => t.side === 'SHORT').reduce((a, t) => a + t.net, 0) };
if (process.argv.includes('--json')) fs.writeFileSync(process.argv[process.argv.indexOf('--json') + 1], JSON.stringify({ summary, trades }, null, 1));
else { trades.forEach(t => console.log(t.side.padEnd(5), t.entryDate, t.entry, '->', t.exitDate, t.exit, String(t.net).padStart(7), t.reason)); console.log(JSON.stringify(summary)); }
