# NIFTY synthetic futures trend strategy: backtest and redesign

Open **`dashboard.html`** in any browser. It works offline because the data and the engine are embedded in the file. The default preset is the new strategy below; "Original rules" and "Original + SL ₹25K" reproduce the first round.

## Round 2: strategy that fits a ₹8K daily-loss limit (1 lot)

### Rules ("short-trend", NIFTY synthetic future, 1 lot = 65 qty)
**Sell setup.** Check all four at the daily close (in practice about 3:20–3:25 PM):
1. Close is below Supertrend (10,3)
2. Today's candle is red (close < open)
3. This week's candle is red (close < Monday's open)
4. RSI(14) is between 30 and 50 (bearish, but not already oversold)

**Entry:** sell the synthetic (sell ATM CE + buy ATM PE, next monthly expiry) at the close. No new entry on the monthly expiry day or the 2 trading days before it.

**Exit, whichever comes first:**
- Stop loss ₹7,000 on trade MTM (about 108 points), which is ₹7,400 with costs
- Target ₹17,500, which is 2.5R (about 270 points)
- A daily close above EMA 9
- The close of the 5th session in the trade

**Longs:** none. Across the whole search, no long rule held up in both periods (see below).

### Results (daily bhavcopy data, after ₹400 costs per round trip and carry)
| Period | Trades | Win % | Avg win : avg loss | Net | Max DD (on ₹2L) | Worst non-gap day |
|---|---|---|---|---|---|---|
| 1 Jan 2025 – 21 Nov 2025 | 17 | 52.9% | 3.1 : 1 | +₹1,25,524 | 7.4% | −₹7,400 |
| 24 Nov 2025 – 23 Nov 2026 | 14 | 50.0% | 3.0 : 1 | +₹1,01,111 | 7.6% | −₹7,400 |
| **Total** | **31** | **51.6%** | **3.0 : 1** | **+₹2,26,635** | **7.6%** | **−₹7,400** (gap day −₹8,670) |

| Your limit | Result |
|---|---|
| Max ₹8K loss per day, gaps excepted | ✓ every stop costs ₹7,400 |
| Drawdown < 10% | ✓ 7.6% of ₹2L |
| Win ≥ 1:2 | ✓ target is 2.5R; the average win is 3× the average loss |
| Win rate > 60% | ✗ 50–53%. No setup achieved this in both periods (see below) |

### Caveats
- One trade (shorting on 4 Apr 2025, before the tariff gap-down) made ₹74,889. Without it, the total is ₹1,51,746.
- **Entry timing is critical.** Entering at the next day's open instead of the signal close drops the 2025 win rate to 18%. You have to place the order in the last few minutes of the session.
- The rules were chosen by requiring them to pass in both periods, so neither period is a clean out-of-sample test. Selection bias check: of the 2,683 setups that met every limit on 2025 alone, 73% stayed profitable in the last 12 months, but only 21% still met every limit, and their median win rate fell to 32%. **Expect live results to be weaker than the backtest.**
- Only about 2 years of daily data is available from nse-bhavcopy (from Oct 2024), and there's no 30-minute data. Paper-trade this before using real money.

### How it was found
1. `search.js`: 390,144 backtests covering every subset of your 7 conditions (127), with optional ADX 20/25 and RSI band filters. For each: 4 entry types (close, next open, pullback limits 0.25/0.5 ATR), 3 directions, 4 risk sizes within ₹8K/day (1 lot SL ₹4K/5.5K/7.6K, 2 lots SL ₹7.3K), target 2R or 3R, with or without breakeven, time exit, and EMA exit.
2. `analyze.js`: applied your limits to Jan–Nov 2025 and the last 12 months separately. 316 setups passed on 2025 alone; **none** passed in both periods with a win rate above 60%. Relaxing the win rate, 715 setups achieved 1:2+, DD < 10% and profit in both periods.
3. `stage2.js`: for each surviving family, swept 648 exit variants and ranked families by the share of variants that still pass (robustness). The short-trend family was at the top (35% of variants pass).
4. `combo.js`: tried adding long rule sets alongside it (one position at a time). Longs reduced robustness every time; the best long add-on passes in only 4% of variants.

Re-run with `node search.js && node analyze.js && node stage2.js && node combo.js` (about 2 minutes).

## Round 1: your original rules
### Rules tested
- **Long** (short is the mirror image): close > Supertrend(10,3), close > EMA21, EMA9 > EMA21, EMA18 > EMA42, close > VWAP, plus today's candle bullish and this week's candle bullish.
- **Exit:** close < EMA18, stop loss ₹8K, target ₹40K, lock ₹1.6K once MTM reaches ₹16K, then raise the lock ₹1.6K for every further ₹1.6K.
- **Size:** 2 lots of a synthetic future (ATM CE buy + PE sell).
- **Expiry:** no entries on the monthly expiry day or the 2 trading days before it.

### Data limits (important)
The nse-bhavcopy and cm-market sources only provide **daily** NIFTY 50 OHLCV, with no 30-minute candles, no NIFTY futures and no option premiums. So:
- The strategy runs on daily candles instead of 30-minute ones.
- VWAP is weekly-anchored, using the index's typical price weighted by volume.
- The synthetic future is modelled as spot points × quantity, minus carry (6.5% a year), minus ₹700 per round trip.
- A daily candle doesn't show whether its high or its low came first, so the default assumes the adverse move came first.

### Results (24 Nov 2025 to 23 Nov 2026, after costs)
| Variant | Trades | Net | Win % | PF | Max DD |
|---|---|---|---|---|---|
| A. As specified | 40 | **−₹91,593** | 17.5% | 0.68 | ₹1,30,151 |
| A, entry at signal close | 39 | +₹54,676 | 30.8% | 1.16 | ₹1,00,982 |
| A, favourable-first intrabar | 43 | +₹64,300 | 39.5% | 1.28 | ₹81,100 |
| C. Recommended: SL ₹25K + re-entry only after the signal resets | 26 | **+₹1,30,901** | 53.8% | 1.43 | ₹78,212 |
| C, entry at signal close | 28 | +₹1,95,537 | 53.6% | 1.55 | ₹99,133 |
| C, favourable-first intrabar | 26 | +₹7,982 | 57.7% | 1.03 | ₹94,711 |
| C, long only | 11 | −₹10,712 | 54.5% | 0.91 | ₹83,712 |
| C, short only | 15 | +₹1,41,613 | 53.3% | 1.79 | ₹51,400 |

Run `node run_backtest.js` (add `-v` for the trade list) to reproduce. Edit `variants.json` to test other settings, and run `node build_dashboard.js` to rebuild the dashboard after changing the engine or data.

## Files
- `engine.js`: indicators and backtest engine (the same code runs in node and in the dashboard)
- `data/nifty50_daily.csv`: NSE bhavcopy NIFTY 50 daily data, Oct 2024 to Nov 2026
- `search.js`, `analyze.js`, `stage2.js`, `combo.js`, `results/search_stage2.json`: round-2 combination search
- `run_backtest.js`, `variants.json`, `results.txt`: variant comparison
- `dashboard.template.html`, `build_dashboard.js`, `dashboard.html`: offline dashboard
