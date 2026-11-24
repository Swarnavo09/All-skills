/*
 * Synthetic-futures trend strategy backtest engine (NIFTY 50).
 * One file, used by both node (run_backtest.js) and the offline dashboard,
 * so the numbers in the report and on the dashboard come from the same code.
 *
 * Bars are DAILY bhavcopy candles (the MCP sources have no intraday data).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Engine = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const DEFAULTS = {
    startDate: '2025-11-24',     // backtest window start (earlier bars = indicator warm-up)
    stAtr: 10, stMult: 3,         // Supertrend (10,3)
    emaFast: 9, emaMid: 21, emaSlowA: 18, emaSlowB: 42, emaExit: 18,
    useVwap: true,                // close vs weekly-anchored VWAP
    useHtf: true,                 // daily + weekly candle colour filter
    allowLong: true, allowShort: true,
    entryMode: 'nextOpen',        // 'nextOpen' (no look-ahead) | 'close'
    lots: 2,
    lotSizeOld: 75, lotSizeNew: 65, lotChangeDate: '2025-12-31',
    stopLoss: 8000, target: 40000,
    lockAt: 16000, lockTo: 1600, trailStep: 1600, trailBy: 1600,
    skipExpiryDays: 2,            // block fresh entries on the N trading days before monthly expiry (and expiry day)
    intrabar: 'adverseFirst',     // daily bars can't tell if high or low came first: 'adverseFirst' (conservative) | 'favourableFirst'
    reentry: 'immediate',         // 'immediate' | 'reset' (signal must switch off before same-side re-entry)
    costPerTrade: 700,            // round-trip charges + slippage for 2 legs x 2 lots (Rs)
    rollCost: 700,                // charged if a position is held through a monthly expiry
    carryRate: 0.065,             // synthetic future carry (annual) - long pays, short earns
    capital: 400000,              // assumed margin for 2-lot synthetic future
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

  function supertrend(bars, period, mult) {
    const n = bars.length;
    const tr = bars.map((b, i) => i === 0 ? b.h - b.l :
      Math.max(b.h - b.l, Math.abs(b.h - bars[i - 1].c), Math.abs(b.l - bars[i - 1].c)));
    const atr = new Array(n).fill(NaN);          // Wilder RMA, as TradingView
    let s = 0;
    for (let i = 0; i < n; i++) {
      if (i < period) { s += tr[i]; if (i === period - 1) atr[i] = s / period; continue; }
      atr[i] = (atr[i - 1] * (period - 1) + tr[i]) / period;
    }
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
    return { line, dir, atr };
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

  // ---------- monthly expiry calendar (last Tuesday; previous trading day if holiday) ----------
  function monthlyExpiries(bars) {
    const dates = new Set(bars.map(b => b.date));
    const last = bars[bars.length - 1].date;
    const months = [...new Set(bars.map(b => b.date.slice(0, 7)))];
    const res = {};
    months.forEach(m => {
      const [y, mo] = m.split('-').map(Number);
      const d = new Date(Date.UTC(y, mo, 0));                // last day of month
      while (d.getUTCDay() !== 2) d.setUTCDate(d.getUTCDate() - 1);
      // NIFTY monthly expiry was last Thursday until Aug-2025
      if (y < 2025 || (y === 2025 && mo < 9)) {
        d.setTime(Date.UTC(y, mo, 0));
        while (d.getUTCDay() !== 4) d.setUTCDate(d.getUTCDate() - 1);
      }
      let s = d.toISOString().slice(0, 10);
      // shift to previous trading day if it was a holiday (only knowable inside the data range)
      while (s <= last && !dates.has(s)) {
        d.setUTCDate(d.getUTCDate() - 1); s = d.toISOString().slice(0, 10);
      }
      res[m] = s;
    });
    return res;
  }

  function blockedDates(bars, expiries, nDays) {
    const blocked = {};
    const idx = bars.map(b => b.date);
    Object.values(expiries).forEach(e => {
      blocked[e] = 'expiry';
      const before = idx.filter(d => d < e).slice(-nDays);
      before.forEach(d => { blocked[d] = 'pre-expiry'; });
    });
    return blocked;
  }

  // ---------- backtest ----------
  function run(rawBars, userParams) {
    const p = Object.assign({}, DEFAULTS, userParams || {});
    const bars = rawBars;
    const n = bars.length;
    const closes = bars.map(b => b.c);
    const e9 = ema(closes, p.emaFast), e21 = ema(closes, p.emaMid);
    const e18 = ema(closes, p.emaSlowA), e42 = ema(closes, p.emaSlowB);
    const eExit = p.emaExit === p.emaSlowA ? e18 : ema(closes, p.emaExit);
    const st = supertrend(bars, p.stAtr, p.stMult);
    const wk = weeklyContext(bars);
    const expiries = monthlyExpiries(bars);
    const blocked = blockedDates(bars, expiries, p.skipExpiryDays);
    const expirySet = new Set(Object.values(expiries));
    const startIdx = bars.findIndex(b => b.date >= p.startDate);

    function conds(i) {
      const b = bars[i];
      const L = {
        st: b.c > st.line[i], ema21: b.c > e21[i], e9_21: e9[i] > e21[i], e18_42: e18[i] > e42[i],
        vwap: !p.useVwap || b.c > wk.vwap[i], day: !p.useHtf || b.c > b.o, week: !p.useHtf || b.c > wk.wOpen[i],
      };
      const S = {
        st: b.c < st.line[i], ema21: b.c < e21[i], e9_21: e9[i] < e21[i], e18_42: e18[i] < e42[i],
        vwap: !p.useVwap || b.c < wk.vwap[i], day: !p.useHtf || b.c < b.o, week: !p.useHtf || b.c < wk.wOpen[i],
      };
      const all = o => Object.values(o).every(Boolean);
      return { L, S, long: p.allowLong && all(L), short: p.allowShort && all(S) };
    }

    const qtyFor = date => p.lots * (date < p.lotChangeDate ? p.lotSizeOld : p.lotSizeNew);
    const trades = [], equity = [], signals = [], skipped = [];
    let pos = null, realized = 0, pending = null;
    let lockout = { 1: false, '-1': false };

    function stopPnlFor(maxMtm) {
      if (maxMtm >= p.lockAt) return p.lockTo + Math.floor((maxMtm - p.lockAt) / p.trailStep) * p.trailBy;
      return -p.stopLoss;
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
        gross: round0(gross), cost: round0(cost), net: round0(net), reason,
        bars: i - pos.entryIdx + 1, mfe: round0(pos.maxMtm), mae: round0(pos.minMtm), rolls: pos.rolls,
      });
      lockout[pos.dir] = p.reentry === 'reset';
      pos = null;
    }

    for (let i = Math.max(startIdx, 1); i < n; i++) {
      const b = bars[i];
      let exitedThisBar = false;

      // 1) fill pending next-open entry
      if (pending && !pos) {
        pos = { dir: pending.dir, entry: b.o, entryDate: b.date, entryIdx: i, qty: qtyFor(b.date),
          maxMtm: 0, minMtm: 0, stopPnl: -p.stopLoss, rolls: 0, openFill: true, sigDate: pending.sigDate };
        pending = null;
      }

      // 2) manage open position on this bar
      if (pos && !(pos.entryIdx === i && !pos.openFill)) {
        const d = pos.dir, q = pos.qty;
        const carryPts = pos.entry * p.carryRate * daysBetween(pos.entryDate, b.date) / 365;
        const px = pnl => pos.entry + carryPts + d * pnl / q;   // price at which MTM == pnl
        const mtm = price => d * (price - pos.entry) * q - d * carryPts * q;
        const fav = d === 1 ? b.h : b.l, adv = d === 1 ? b.l : b.h;
        const beyond = (price, level, favourable) => favourable
          ? (d === 1 ? price >= level : price <= level)
          : (d === 1 ? price <= level : price >= level);
        const isEntryBar = pos.entryIdx === i;
        const stopPx = px(pos.stopPnl), tgtPx = px(p.target);
        const stopReason = () => pos.stopPnl > 0 ? 'Trail SL' : 'Stop loss';

        if (!isEntryBar && beyond(b.o, stopPx, false)) { closePos(i, b.o, stopReason() + ' (gap)'); }
        else if (!isEntryBar && beyond(b.o, tgtPx, true)) { closePos(i, b.o, 'Target (gap)'); }
        else {
          pos.minMtm = Math.min(pos.minMtm, mtm(adv));
          if (p.intrabar === 'favourableFirst') {                                         // optimistic bound
            if (beyond(fav, tgtPx, true)) { pos.maxMtm = Math.max(pos.maxMtm, p.target); closePos(i, tgtPx, 'Target'); }
            else {
              pos.maxMtm = Math.max(pos.maxMtm, mtm(fav));
              pos.stopPnl = Math.max(pos.stopPnl, stopPnlFor(pos.maxMtm));
              if (beyond(adv, px(pos.stopPnl), false)) closePos(i, px(pos.stopPnl), stopReason());
              else if (d === 1 ? b.c < eExit[i] : b.c > eExit[i]) closePos(i, b.c, 'EMA' + p.emaExit + ' exit');
            }
          }
          else if (beyond(adv, stopPx, false)) { closePos(i, stopPx, stopReason()); }        // adverse first (conservative)
          else if (beyond(fav, tgtPx, true)) { pos.maxMtm = Math.max(pos.maxMtm, p.target); closePos(i, tgtPx, 'Target'); }
          else {
            pos.maxMtm = Math.max(pos.maxMtm, mtm(fav));
            const newStop = Math.max(pos.stopPnl, stopPnlFor(pos.maxMtm));
            const raised = newStop > pos.stopPnl;
            pos.stopPnl = newStop;
            if (raised && beyond(b.c, px(newStop), false)) { closePos(i, px(newStop), 'Trail SL'); }
            else if (d === 1 ? b.c < eExit[i] : b.c > eExit[i]) { closePos(i, b.c, 'EMA' + p.emaExit + ' exit'); }
          }
        }
        if (!pos) exitedThisBar = true;
        else if (expirySet.has(b.date)) pos.rolls++;
      }

      // 3) mark-to-market equity
      let open = 0;
      if (pos) {
        const carry = pos.entry * p.carryRate * daysBetween(pos.entryDate, b.date) / 365;
        open = pos.dir * (b.c - pos.entry) * pos.qty - pos.dir * carry * pos.qty;
      }
      equity.push({ date: b.date, equity: round0(realized + open), realized: round0(realized) });

      // 4) look for a fresh signal at this close
      const c = conds(i);
      if (!c.long) lockout[1] = false;
      if (!c.short) lockout[-1] = false;
      if (!pos && !pending) {
        let dir = c.long && !lockout[1] ? 1 : c.short && !lockout[-1] ? -1 : 0;
        if (dir) {
          const entryDate = p.entryMode === 'close' ? b.date : (bars[i + 1] ? bars[i + 1].date : null);
          signals.push({ date: b.date, dir });
          if (!entryDate) { /* last bar: signal only */ }
          else if (blocked[entryDate]) skipped.push({ date: entryDate, dir, why: blocked[entryDate] });
          else if (p.entryMode === 'close') {
            pos = { dir, entry: b.c, entryDate: b.date, entryIdx: i, qty: qtyFor(b.date),
              maxMtm: 0, minMtm: 0, stopPnl: -p.stopLoss, rolls: 0, openFill: false, sigDate: b.date };
          } else pending = { dir, sigDate: b.date };
        }
      }
      void exitedThisBar;
    }
    // close anything still open at the last close (marked as open MTM)
    if (pos) closePos(n - 1, bars[n - 1].c, 'Open @ last close');

    return {
      params: p, trades, equity, signals, skipped, expiries,
      stats: stats(trades, equity, p),
      series: { e9, e21, e18, e42, st: st.line, stDir: st.dir, vwap: wk.vwap, startIdx },
    };
  }

  function stats(trades, equity, p) {
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
    return {
      trades: trades.length, net: round0(net), gross: round0(trades.reduce((a, t) => a + t.gross, 0)),
      costs: round0(trades.reduce((a, t) => a + t.cost, 0)),
      winRate: trades.length ? wins.length / trades.length : 0,
      avgWin: wins.length ? gw / wins.length : 0, avgLoss: losses.length ? -gl / losses.length : 0,
      profitFactor: gl ? gw / gl : (gw ? Infinity : 0), expectancy: trades.length ? net / trades.length : 0,
      maxDD: round0(mdd), maxDDDate: mddDate, maxLossStreak: maxStreak,
      returnPct: net / p.capital, retToDD: mdd ? net / mdd : null,
      bySide: by(t => t.side), byReason: by(t => t.reason.replace(' (gap)', '')), monthly,
      exposureDays: trades.reduce((a, t) => a + t.bars, 0), totalDays: equity.length,
    };
  }

  function daysBetween(a, b) { return Math.round((Date.parse(b) - Date.parse(a)) / 864e5); }
  function round0(x) { return Math.round(x); }
  function round2(x) { return Math.round(x * 100) / 100; }

  return { run, DEFAULTS, ema, supertrend, monthlyExpiries };
});
