/*
 * Synthetic-futures trend strategy backtest engine (NIFTY 50).
 * One file, used by node (run_backtest.js, search.js) and by the offline dashboard,
 * so the numbers in the report and on the dashboard come from the same code.
 *
 * Bars are DAILY bhavcopy candles (the MCP sources have no intraday data).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Engine = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const ALL_CONDS = ['st', 'ema21', 'e9_21', 'e18_42', 'vwap', 'day', 'week'];
  const COND_LABELS = {
    st: 'Close vs Supertrend', ema21: 'Close vs EMA21', e9_21: 'EMA9 vs EMA21', e18_42: 'EMA18 vs EMA42',
    vwap: 'Close vs weekly VWAP', day: 'Daily candle colour', week: 'Weekly candle colour',
    adx: 'ADX(14) above threshold', rsi: 'RSI(14) inside band',
  };

  const DEFAULTS = {
    startDate: '2025-11-24',     // trading window start (earlier bars = indicator warm-up)
    endDate: null,               // trading window end (inclusive); null = last bar
    stAtr: 10, stMult: 3,         // Supertrend (10,3)
    emaFast: 9, emaMid: 21, emaSlowA: 18, emaSlowB: 42,
    emaExit: 18,                  // exit on close beyond this EMA; 0 = off
    conds: null,                  // list of required conditions; null = ALL_CONDS
    useVwap: true, useHtf: true,  // legacy switches (drop vwap / day+week from the list)
    adxLen: 14, adxMin: 20,       // used when 'adx' is in conds
    rsiLen: 14, rsiLo: 50, rsiHi: 70, // long band; short uses 100-hi .. 100-lo
    allowLong: true, allowShort: true,
    entryMode: 'nextOpen',        // 'nextOpen' | 'close' | 'limit' (next-day pullback limit, else cancelled)
    limitAtr: 0.25,               // limit = signal close -/+ limitAtr x ATR(14)
    lots: 2,
    lotSizeOld: 75, lotSizeNew: 65, lotChangeDate: '2025-12-31',
    stopLoss: 8000,               // Rs, on trade MTM (incl. carry)
    target: 40000,                // Rs
    targetR: 0,                   // if > 0, target = stopLoss x targetR
    lockAt: 16000, lockTo: 1600, trailStep: 1600, trailBy: 1600,   // lockAt = 0 disables
    maxBars: 0,                   // time exit at the close of the Nth session in trade; 0 = off
    intrabar: 'adverseFirst',     // daily bars can't tell if high or low came first: 'adverseFirst' | 'favourableFirst'
    reentry: 'immediate',         // 'immediate' | 'reset' (signal must switch off before same-side re-entry)
    skipExpiryDays: 2,            // block fresh entries on the N trading days before monthly expiry (and expiry day)
    costPerTrade: 700,            // round-trip charges + slippage (Rs)
    rollCost: 700,                // charged if a position is held through a monthly expiry
    carryRate: 0.065,             // synthetic future carry (annual) - long pays, short earns
    capital: 400000,              // assumed capital for return / drawdown %
  };

  // ---------- indicators ----------
  function ema(src, n) {
    const out = new Array(src.length).fill(NaN);
    const k = 2 / (n + 1);
    let sum = 0;
    for (let i = 0; i < src.length; i++) {
      if (i < n - 1) { sum += src[i]; continue; }
      if (i === n - 1) { sum += src[i]; out[i] = sum / n; continue; }
      out[i] = src[i] * k + out[i - 1] * (1 - k);
    }
    return out;
  }
  function rma(src, n) {                      // Wilder smoothing
    const out = new Array(src.length).fill(NaN);
    let s = 0;
    for (let i = 0; i < src.length; i++) {
      if (i < n) { s += src[i]; if (i === n - 1) out[i] = s / n; continue; }
      out[i] = (out[i - 1] * (n - 1) + src[i]) / n;
    }
    return out;
  }
  function trueRange(bars) {
    return bars.map((b, i) => i === 0 ? b.h - b.l :
      Math.max(b.h - b.l, Math.abs(b.h - bars[i - 1].c), Math.abs(b.l - bars[i - 1].c)));
  }
  function supertrend(bars, period, mult) {
    const n = bars.length, atr = rma(trueRange(bars), period);
    const line = new Array(n).fill(NaN), dir = new Array(n).fill(0);
    let up = NaN, dn = NaN, trend = 1;
    for (let i = 0; i < n; i++) {
      if (isNaN(atr[i])) continue;
      const hl2 = (bars[i].h + bars[i].l) / 2;
      let u = hl2 - mult * atr[i], d = hl2 + mult * atr[i];
      if (!isNaN(up)) {
        const pc = bars[i - 1].c;
        u = pc > up ? Math.max(u, up) : u;
        d = pc < dn ? Math.min(d, dn) : d;
        if (trend === -1 && bars[i].c > dn) trend = 1;
        else if (trend === 1 && bars[i].c < up) trend = -1;
      }
      up = u; dn = d;
      dir[i] = trend; line[i] = trend === 1 ? up : dn;
    }
    return { line, dir };
  }
  function rsi(closes, n) {
    const g = closes.map((c, i) => i ? Math.max(0, c - closes[i - 1]) : 0);
    const l = closes.map((c, i) => i ? Math.max(0, closes[i - 1] - c) : 0);
    const ag = rma(g, n), al = rma(l, n);
    return ag.map((a, i) => isNaN(a) ? NaN : al[i] === 0 ? 100 : 100 - 100 / (1 + a / al[i]));
  }
  function adx(bars, n) {
    const pdm = bars.map((b, i) => { if (!i) return 0; const u = b.h - bars[i - 1].h, d = bars[i - 1].l - b.l; return u > d && u > 0 ? u : 0; });
    const ndm = bars.map((b, i) => { if (!i) return 0; const u = b.h - bars[i - 1].h, d = bars[i - 1].l - b.l; return d > u && d > 0 ? d : 0; });
    const tr = rma(trueRange(bars), n), p = rma(pdm, n), m = rma(ndm, n);
    const dx = tr.map((t, i) => { const pd = 100 * p[i] / t, md = 100 * m[i] / t; return isNaN(t) ? NaN : (pd + md ? 100 * Math.abs(pd - md) / (pd + md) : 0); });
    const firstValid = dx.findIndex(v => !isNaN(v));
    const out = new Array(bars.length).fill(NaN);
    if (firstValid >= 0) rma(dx.slice(firstValid), n).forEach((v, k) => { out[firstValid + k] = v; });
    return out;
  }
  function weekKey(dateStr) {               // ISO week id
    const d = new Date(dateStr + 'T00:00:00Z');
    const day = (d.getUTCDay() + 6) % 7;
    d.setUTCDate(d.getUTCDate() - day + 3);
    const y = d.getUTCFullYear();
    const jan4 = new Date(Date.UTC(y, 0, 4));
    const wk = 1 + Math.round(((d - jan4) / 864e5 - 3 + ((jan4.getUTCDay() + 6) % 7)) / 7);
    return y + '-W' + wk;
  }
  function weeklyContext(bars) {
    // weekly-anchored VWAP (typical price x index volume) and week-to-date open
    const vwap = [], wOpen = [];
    let key = null, pv = 0, vv = 0, wo = NaN;
    bars.forEach(b => {
      const k = weekKey(b.date);
      if (k !== key) { key = k; pv = 0; vv = 0; wo = b.o; }
      const v = b.v || 1;
      pv += ((b.h + b.l + b.c) / 3) * v; vv += v;
      vwap.push(pv / vv); wOpen.push(wo);
    });
    return { vwap, wOpen };
  }

  // ---------- monthly expiry calendar ----------
  function monthlyExpiries(bars) {
    const dates = new Set(bars.map(b => b.date));
    const last = bars[bars.length - 1].date;
    const months = [...new Set(bars.map(b => b.date.slice(0, 7)))];
    const res = {};
    months.forEach(m => {
      const [y, mo] = m.split('-').map(Number);
      const d = new Date(Date.UTC(y, mo, 0));
      // NIFTY monthly expiry: last Thursday until Aug-2025, last Tuesday from Sep-2025
      const wd = (y < 2025 || (y === 2025 && mo < 9)) ? 4 : 2;
      while (d.getUTCDay() !== wd) d.setUTCDate(d.getUTCDate() - 1);
      let s = d.toISOString().slice(0, 10);
      while (s <= last && !dates.has(s)) { d.setUTCDate(d.getUTCDate() - 1); s = d.toISOString().slice(0, 10); }
      res[m] = s;
    });
    return res;
  }
  function blockedDates(bars, expiries, nDays) {
    const blocked = {};
    const idx = bars.map(b => b.date);
    Object.values(expiries).forEach(e => {
      blocked[e] = 'expiry';
      (nDays > 0 ? idx.filter(d => d < e).slice(-nDays) : []).forEach(d => { blocked[d] = 'pre-expiry'; });
    });
    return blocked;
  }

  // indicator cache (search runs thousands of backtests on the same bars)
  const cache = new WeakMap();
  function prep(bars, p) {
    let c = cache.get(bars);
    if (!c) { c = { closes: bars.map(b => b.c), m: {} }; cache.set(bars, c); }
    const get = (k, f) => (c.m[k] || (c.m[k] = f()));
    return {
      e: n => get('ema' + n, () => ema(c.closes, n)),
      st: get('st' + p.stAtr + '_' + p.stMult, () => supertrend(bars, p.stAtr, p.stMult)),
      wk: get('wk', () => weeklyContext(bars)),
      atr: get('atr14', () => rma(trueRange(bars), 14)),
      rsi: get('rsi' + p.rsiLen, () => rsi(c.closes, p.rsiLen)),
      adx: get('adx' + p.adxLen, () => adx(bars, p.adxLen)),
      expiries: get('exp', () => monthlyExpiries(bars)),
      blocked: get('blk' + p.skipExpiryDays, () => blockedDates(bars, get('exp', () => monthlyExpiries(bars)), p.skipExpiryDays)),
    };
  }

  // ---------- backtest ----------
  function run(bars, userParams) {
    const p = Object.assign({}, DEFAULTS, userParams || {});
    const n = bars.length;
    const X = prep(bars, p);
    const e9 = X.e(p.emaFast), e21 = X.e(p.emaMid), e18 = X.e(p.emaSlowA), e42 = X.e(p.emaSlowB);
    const st = X.st, wk = X.wk, atr = X.atr, rsiV = X.rsi, adxV = X.adx;
    const expirySet = new Set(Object.values(X.expiries));
    const blocked = X.blocked;
    // per-side overrides: p.long / p.short may replace conds, entry, risk and exit settings for that side
    const side = { 1: Object.assign({}, p, p.long || {}), '-1': Object.assign({}, p, p.short || {}) };
    [1, -1].forEach(d => {
      const sp = side[d];
      let c = (sp.conds || ALL_CONDS).slice();
      if (!sp.useVwap) c = c.filter(k => k !== 'vwap');
      if (!sp.useHtf) c = c.filter(k => k !== 'day' && k !== 'week');
      sp.condList = c;
      sp.tgt = sp.targetR > 0 ? sp.stopLoss * sp.targetR : sp.target;
      sp.exitEma = sp.emaExit ? X.e(sp.emaExit) : null;
    });
    const conds = side[1].condList;
    const target = side[1].tgt;
    const startIdx = Math.max(1, bars.findIndex(b => b.date >= p.startDate));
    let endIdx = n - 1;
    if (p.endDate) { while (endIdx > 0 && bars[endIdx].date > p.endDate) endIdx--; }

    function check(i, d) {          // all required conditions for direction d (+1 / -1)
      const b = bars[i], sp = side[d], cl = sp.condList;
      for (let k = 0; k < cl.length; k++) {
        let ok;
        switch (cl[k]) {
          case 'st': ok = d * (b.c - st.line[i]) > 0; break;
          case 'ema21': ok = d * (b.c - e21[i]) > 0; break;
          case 'e9_21': ok = d * (e9[i] - e21[i]) > 0; break;
          case 'e18_42': ok = d * (e18[i] - e42[i]) > 0; break;
          case 'vwap': ok = d * (b.c - wk.vwap[i]) > 0; break;
          case 'day': ok = d * (b.c - b.o) > 0; break;
          case 'week': ok = d * (b.c - wk.wOpen[i]) > 0; break;
          case 'adx': ok = adxV[i] >= sp.adxMin; break;
          case 'rsi': ok = d === 1 ? rsiV[i] >= sp.rsiLo && rsiV[i] <= sp.rsiHi : rsiV[i] <= 100 - sp.rsiLo && rsiV[i] >= 100 - sp.rsiHi; break;
          default: ok = true;
        }
        if (!ok) return false;
      }
      return true;
    }

    const qtyFor = date => p.lots * (date < p.lotChangeDate ? p.lotSizeOld : p.lotSizeNew);
    const trades = [], equity = [], signals = [], skipped = [];
    let pos = null, realized = 0, pending = null;
    const lockout = { 1: false, '-1': false };

    function stopPnlFor(maxMtm, sp) {
      if (sp.lockAt > 0 && maxMtm >= sp.lockAt) return sp.lockTo + (sp.trailStep > 0 ? Math.floor((maxMtm - sp.lockAt) / sp.trailStep) * sp.trailBy : 0);
      return -sp.stopLoss;
    }
    function open(dir, price, i, fill, sigDate) {
      pos = { dir, entry: price, entryDate: bars[i].date, entryIdx: i, qty: qtyFor(bars[i].date),
        maxMtm: 0, minMtm: 0, stopPnl: -side[dir].stopLoss, rolls: 0, fill, sigDate, sp: side[dir] };
    }
    function closePos(i, price, reason) {
      const b = bars[i];
      const carry = pos.entry * p.carryRate * daysBetween(pos.entryDate, b.date) / 365;
      const gross = pos.dir * (price - pos.entry) * pos.qty - pos.dir * carry * pos.qty;
      const cost = p.costPerTrade + pos.rolls * p.rollCost;
      const net = gross - cost;
      realized += net;
      trades.push({
        id: trades.length + 1, side: pos.dir === 1 ? 'LONG' : 'SHORT',
        entryDate: pos.entryDate, entryIdx: pos.entryIdx, entry: round2(pos.entry),
        exitDate: b.date, exitIdx: i, exit: round2(price), qty: pos.qty,
        points: round2(pos.dir * (price - pos.entry)), carry: round0(-pos.dir * carry * pos.qty),
        gross: round0(gross), cost: round0(cost), net: round0(net), reason, gap: reason.indexOf('(gap)') > 0,
        bars: i - pos.entryIdx + 1, mfe: round0(pos.maxMtm), mae: round0(pos.minMtm), rolls: pos.rolls,
      });
      lockout[pos.dir] = p.reentry === 'reset';
      pos = null;
    }

    for (let i = startIdx; i <= endIdx; i++) {
      const b = bars[i];

      // 1) fill a pending order from yesterday's signal
      if (pending && !pos) {
        const d = pending.dir;
        if (pending.mode === 'limit') {
          const L = pending.limit;
          if (d * (b.o - L) <= 0) open(d, b.o, i, 'open', pending.sigDate);          // opened through the limit
          else if (d === 1 ? b.l <= L : b.h >= L) open(d, L, i, 'intrabar', pending.sigDate);
          else skipped.push({ date: b.date, dir: d, why: 'limit not filled' });
        } else open(d, b.o, i, 'open', pending.sigDate);
        pending = null;
      }

      // 2) manage the open position on this bar
      if (pos && !(pos.entryIdx === i && pos.fill === 'close')) {
        const d = pos.dir, q = pos.qty, sp = pos.sp, target = sp.tgt, eExit = sp.exitEma;
        const carryPts = pos.entry * p.carryRate * daysBetween(pos.entryDate, b.date) / 365;
        const px = pnl => pos.entry + carryPts + d * pnl / q;          // price at which MTM == pnl
        const mtm = price => d * (price - pos.entry) * q - d * carryPts * q;
        const isEntryBar = pos.entryIdx === i;
        // on an intrabar limit fill we don't know what came before the fill: only the close counts as favourable
        const fav = isEntryBar && pos.fill === 'intrabar' ? b.c : (d === 1 ? b.h : b.l);
        const adv = d === 1 ? b.l : b.h;
        const beyond = (price, level, favourable) => favourable ? d * (price - level) >= 0 : d * (price - level) <= 0;
        const stopPx = px(pos.stopPnl), tgtPx = px(target);
        const stopReason = () => pos.stopPnl > 0 ? 'Trail SL' : pos.stopPnl > -sp.stopLoss ? 'Breakeven SL' : 'Stop loss';
        const closeExit = () => {
          if (eExit && d * (b.c - eExit[i]) < 0) closePos(i, b.c, 'EMA' + sp.emaExit + ' exit');
          else if (sp.maxBars > 0 && i - pos.entryIdx + 1 >= sp.maxBars) closePos(i, b.c, 'Time exit');
        };

        if (!isEntryBar && beyond(b.o, stopPx, false)) closePos(i, b.o, stopReason() + ' (gap)');
        else if (!isEntryBar && beyond(b.o, tgtPx, true)) closePos(i, b.o, 'Target (gap)');
        else {
          pos.minMtm = Math.min(pos.minMtm, mtm(adv));
          if (p.intrabar === 'favourableFirst') {
            if (beyond(fav, tgtPx, true)) { pos.maxMtm = Math.max(pos.maxMtm, target); closePos(i, tgtPx, 'Target'); }
            else {
              pos.maxMtm = Math.max(pos.maxMtm, mtm(fav));
              pos.stopPnl = Math.max(pos.stopPnl, stopPnlFor(pos.maxMtm, sp));
              if (beyond(adv, px(pos.stopPnl), false)) closePos(i, px(pos.stopPnl), stopReason());
              else closeExit();
            }
          } else if (beyond(adv, stopPx, false)) closePos(i, stopPx, stopReason());   // adverse first (conservative)
          else if (beyond(fav, tgtPx, true)) { pos.maxMtm = Math.max(pos.maxMtm, target); closePos(i, tgtPx, 'Target'); }
          else {
            pos.maxMtm = Math.max(pos.maxMtm, mtm(fav));
            const newStop = Math.max(pos.stopPnl, stopPnlFor(pos.maxMtm, sp));
            const raised = newStop > pos.stopPnl;
            pos.stopPnl = newStop;
            if (raised && beyond(b.c, px(newStop), false)) closePos(i, px(newStop), stopReason());
            else closeExit();
          }
        }
        if (pos && expirySet.has(b.date)) pos.rolls++;
      }

      // 3) mark-to-market equity
      let openPnl = 0;
      if (pos) {
        const carry = pos.entry * p.carryRate * daysBetween(pos.entryDate, b.date) / 365;
        openPnl = pos.dir * (b.c - pos.entry) * pos.qty - pos.dir * carry * pos.qty;
      }
      equity.push({ date: b.date, equity: round0(realized + openPnl), realized: round0(realized) });

      // 4) fresh signal at this close
      const longOk = p.allowLong && check(i, 1), shortOk = p.allowShort && check(i, -1);
      if (!longOk) lockout[1] = false;
      if (!shortOk) lockout[-1] = false;
      if (!pos && !pending) {
        const dir = longOk && !lockout[1] ? 1 : shortOk && !lockout[-1] ? -1 : 0;
        if (dir) {
          const mode = side[dir].entryMode;
          const entryDate = mode === 'close' ? b.date : (i + 1 <= endIdx ? bars[i + 1].date : null);
          signals.push({ date: b.date, dir });
          if (!entryDate) { /* last bar: signal only */ }
          else if (blocked[entryDate]) skipped.push({ date: entryDate, dir, why: blocked[entryDate] });
          else if (mode === 'close') open(dir, b.c, i, 'close', b.date);
          else pending = { dir, mode, sigDate: b.date, limit: b.c - dir * side[dir].limitAtr * atr[i] };
        }
      }
    }
    if (pos) closePos(endIdx, bars[endIdx].c, 'Open @ last close');

    return {
      params: p, trades, equity, signals, skipped, expiries: X.expiries, conds,
      stats: stats(trades, equity, p, target),
      series: { e9, e21, e18, e42, eExit: p.emaExit ? X.e(p.emaExit) : e18, exitLen: p.emaExit || 18, st: st.line, stDir: st.dir, vwap: wk.vwap, adx: adxV, rsi: rsiV, startIdx, endIdx },
    };
  }

  function stats(trades, equity, p, target) {
    const net = trades.reduce((a, t) => a + t.net, 0);
    const wins = trades.filter(t => t.net > 0), losses = trades.filter(t => t.net <= 0);
    const gw = wins.reduce((a, t) => a + t.net, 0), gl = -losses.reduce((a, t) => a + t.net, 0);
    let peak = 0, mdd = 0, mddDate = null;
    equity.forEach(e => { peak = Math.max(peak, e.equity); if (peak - e.equity > mdd) { mdd = peak - e.equity; mddDate = e.date; } });
    let streak = 0, maxStreak = 0;
    trades.forEach(t => { streak = t.net <= 0 ? streak + 1 : 0; maxStreak = Math.max(maxStreak, streak); });
    const by = key => trades.reduce((m, t) => { const k = key(t); (m[k] = m[k] || { n: 0, net: 0, wins: 0 }); m[k].n++; m[k].net += t.net; if (t.net > 0) m[k].wins++; return m; }, {});
    const monthly = {};
    let prev = 0;
    equity.forEach(e => { const m = e.date.slice(0, 7); monthly[m] = (monthly[m] || 0) + (e.equity - prev); prev = e.equity; });
    Object.keys(monthly).forEach(k => monthly[k] = round0(monthly[k]));
    // worst single-day realised loss (all exits on a date), with and without gap exits
    const day = {}, dayNoGap = {};
    trades.forEach(t => { day[t.exitDate] = (day[t.exitDate] || 0) + t.net; if (!t.gap) dayNoGap[t.exitDate] = (dayNoGap[t.exitDate] || 0) + t.net; });
    const worst = o => Math.min(0, ...Object.values(o));
    const avgWin = wins.length ? gw / wins.length : 0, avgLoss = losses.length ? -gl / losses.length : 0;
    return {
      trades: trades.length, wins: wins.length, losses: losses.length, net: round0(net),
      gross: round0(trades.reduce((a, t) => a + t.gross, 0)), costs: round0(trades.reduce((a, t) => a + t.cost, 0)),
      winRate: trades.length ? wins.length / trades.length : 0, avgWin, avgLoss,
      rr: avgLoss ? avgWin / -avgLoss : (avgWin ? Infinity : 0),
      minWin: wins.length ? Math.min(...wins.map(t => t.net)) : 0, plannedRR: target / p.stopLoss,
      profitFactor: gl ? gw / gl : (gw ? Infinity : 0), expectancy: trades.length ? net / trades.length : 0,
      maxDD: round0(mdd), maxDDDate: mddDate, ddPct: mdd / p.capital, maxLossStreak: maxStreak,
      returnPct: net / p.capital, retToDD: mdd ? net / mdd : null,
      worstDay: round0(worst(day)), worstDayNoGap: round0(worst(dayNoGap)),
      bySide: by(t => t.side), byReason: by(t => t.reason.replace(' (gap)', '')), monthly,
      exposureDays: trades.reduce((a, t) => a + t.bars, 0), totalDays: equity.length,
    };
  }

  function daysBetween(a, b) { return Math.round((Date.parse(b) - Date.parse(a)) / 864e5); }
  function round0(x) { return Math.round(x); }
  function round2(x) { return Math.round(x * 100) / 100; }

  return { run, DEFAULTS, ALL_CONDS, COND_LABELS, ema, supertrend, monthlyExpiries };
});
