"""Target / stop-loss study for the NIFTY synthetic-future strategy (Algorooms).

Position: BUY ATM CE + SELL ATM PE (or the mirror for shorts), 130 qty each
=> behaves like 130 units of NIFTY future, so P&L ~= Rs 130 per NIFTY point.

DATA LIMIT: only NIFTY *daily* OHLC was reachable (NSE bhavcopy). The real
strategy runs on 30-min candles, so this is a PROXY:
  * direction each day = trend filter on daily bars (close>EMA21, EMA9>EMA21,
    close>SuperTrend(10,3)) -- same indicators, daily timeframe
  * entry at the day's open, exit at the close unless SL / target / trail hits
  * when a day's range touches both SL and target we cannot know which came
    first, so every result is shown twice: PESSIMISTIC (SL first) and
    OPTIMISTIC (target first). The truth is somewhere in between.
"""
import json, math, sys

QTY = 130
COST = 150  # rough brokerage+STT+slippage per round trip for 4 option orders (Rs)

rows = json.load(open(sys.argv[1] if len(sys.argv) > 1 else "nifty_daily.json"))

def ema(vals, n):
    k, out, e = 2 / (n + 1), [], None
    for v in vals:
        e = v if e is None else v * k + e * (1 - k)
        out.append(e)
    return out

C = [r["close"] for r in rows]; H = [r["high"] for r in rows]; L = [r["low"] for r in rows]
e9, e21 = ema(C, 9), ema(C, 21)
# SuperTrend(10,3)
tr = [H[0] - L[0]] + [max(H[i] - L[i], abs(H[i] - C[i-1]), abs(L[i] - C[i-1])) for i in range(1, len(C))]
atr, st, up_tr = [], [], True
for i, t in enumerate(tr):
    atr.append(t if i == 0 else (atr[-1] * 9 + t) / 10)
fu = fl = None
for i in range(len(C)):
    hl2 = (H[i] + L[i]) / 2
    bu, bl = hl2 + 3 * atr[i], hl2 - 3 * atr[i]
    fu = bu if fu is None or bu < fu or C[i-1] > fu else fu
    fl = bl if fl is None or bl > fl or C[i-1] < fl else fl
    if up_tr and C[i] < fl: up_tr = False
    elif not up_tr and C[i] > fu: up_tr = True
    st.append(up_tr)

def signal(i):  # uses data up to i-1 only (decided before today's open)
    j = i - 1
    if C[j] > e21[j] and e9[j] > e21[j] and st[j]: return 1
    if C[j] < e21[j] and e9[j] < e21[j] and not st[j]: return -1
    return 0

START = 30  # warm-up for indicators

def day_pnl(r, side, tgt, sl, trail, pessimistic):
    o, h, l, c = r["open"], r["high"], r["low"], r["close"]
    fav = (h - o) if side == 1 else (o - l)      # best move for us (points)
    adv = (o - l) if side == 1 else (h - o)      # worst move against us
    close_pts = (c - o) * side
    fav_rs, adv_rs, close_rs = fav * QTY, adv * QTY, close_pts * QTY
    sl_hit, tg_hit = adv_rs >= sl, (tgt is not None and fav_rs >= tgt)
    if sl_hit and tg_hit:
        return -sl if pessimistic else tgt
    if tg_hit: return tgt
    if sl_hit and pessimistic: return -sl
    if trail:  # lock-and-trail: reach X -> lock Y, every +A raise lock by B
        x, y, a, b = trail
        if fav_rs >= x:
            lock = y + math.floor((fav_rs - x) / a) * b
            # pessimistic: peak came first, then price fell back to the lock
            res = max(close_rs, lock) if not sl_hit else lock
            return res
    if sl_hit: return -sl  # optimistic and SL hit: assume the SL came after the peak
    return close_rs

def run(tgt, sl, trail=None, pessimistic=True):
    pnl = []
    for i in range(START, len(rows)):
        s = signal(i)
        if s: pnl.append((rows[i]["date"], day_pnl(rows[i], s, tgt, sl, trail, pessimistic) - COST))
    vals = [p for _, p in pnl]
    eq, peak, mdd = 0, 0, 0
    for v in vals:
        eq += v; peak = max(peak, eq); mdd = max(mdd, peak - eq)
    wins = sum(v > 0 for v in vals)
    return dict(trades=len(vals), net=round(sum(vals)), win=round(100 * wins / max(1, len(vals))),
                avg=round(sum(vals) / max(1, len(vals))), maxdd=round(mdd),
                worst=round(min(vals)) if vals else 0, best=round(max(vals)) if vals else 0, log=pnl)

if __name__ == "__main__":
    days = rows[START:]
    print(f"Data: {days[0]['date']} -> {days[-1]['date']}  ({len(days)} sessions)\n")

    # 1) How far does NIFTY actually move from the open?
    favs = [max(r['high'] - r['open'], r['open'] - r['low']) for r in days]
    print("How often NIFTY moves X points from the open in its best direction (one day):")
    for rs in (5000, 10000, 15000, 20000, 25000, 30000, 40000):
        pts = rs / QTY
        print(f"  Rs {rs:>6} = {pts:5.0f} pts : {100*sum(f>=pts for f in favs)/len(favs):5.1f}% of days")
    advs = [min(r['high'] - r['open'], r['open'] - r['low']) for r in days]
    print("\nHow often the SMALLER side of the day's range (noise against you) reaches X:")
    for rs in (3000, 5000, 6000, 8000, 10000):
        pts = rs / QTY
        print(f"  Rs {rs:>6} = {pts:5.0f} pts : {100*sum(a>=pts for a in advs)/len(advs):5.1f}% of days")

    LT_NOW = (16000, 1600, 1600, 1600)
    configs = [
        ("CURRENT  T40k / SL8k / lock16k->1.6k trail 1.6k", 40000, 8000, LT_NOW),
        ("T40k / SL8k / no trail",                        40000, 8000, None),
        ("T20k / SL5k / no trail",                        20000, 5000, None),
        ("T20k / SL8k / no trail",                        20000, 8000, None),
        ("T15k / SL5k / no trail",                        15000, 5000, None),
        ("T25k / SL6k / no trail",                        25000, 6000, None),
        ("T30k / SL6k / lock12k->6k trail 3k/3k",         30000, 6000, (12000, 6000, 3000, 3000)),
        ("T40k / SL8k / lock12k->6k trail 2k/2k",         40000, 8000, (12000, 6000, 2000, 2000)),
        ("T25k / SL5k / lock10k->5k trail 2.5k/2.5k",     25000, 5000, (10000, 5000, 2500, 2500)),
        ("T20k / SL5k / lock10k->5k trail 2k/2k",         20000, 5000, (10000, 5000, 2000, 2000)),
    ]
    out = []
    print("\n%-48s %6s | %-34s | %-34s" % ("config", "trades", "PESSIMISTIC net / win% / maxDD", "OPTIMISTIC net / win% / maxDD"))
    for name, t, s, tr in configs:
        p, o = run(t, s, tr, True), run(t, s, tr, False)
        print("%-48s %6d | %10s %4s%% %10s | %10s %4s%% %10s" % (name, p['trades'], f"{p['net']:,}", p['win'], f"{p['maxdd']:,}", f"{o['net']:,}", o['win'], f"{o['maxdd']:,}"))
        out.append(dict(name=name, target=t, sl=s, trail=tr, pess={k: v for k, v in p.items() if k != 'log'},
                        opt={k: v for k, v in o.items() if k != 'log'}))
    json.dump(out, open("results.json", "w"), indent=1)
