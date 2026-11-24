# NIFTY synthetic futures trend strategy: 1-year backtest

Open **`dashboard.html`** in any browser. It works offline because the data and the engine are embedded in the file. You can change any parameter there and the backtest re-runs instantly.

## Rules tested
- **Long** (short is the mirror image): close > Supertrend(10,3), close > EMA21, EMA9 > EMA21, EMA18 > EMA42, close > VWAP, plus today's candle bullish and this week's candle bullish.
- **Exit:** close < EMA18, stop loss ₹8K, target ₹40K, lock ₹1.6K once MTM reaches ₹16K, then raise the lock ₹1.6K for every further ₹1.6K.
- **Size:** 2 lots of a synthetic future (ATM CE buy + PE sell).
- **Expiry:** no entries on the monthly expiry day or the 2 trading days before it.

## Data limits (important)
The nse-bhavcopy and cm-market sources only provide **daily** NIFTY 50 OHLCV, with no 30-minute candles, no NIFTY futures and no option premiums. So:
- The strategy runs on daily candles instead of 30-minute ones.
- VWAP is weekly-anchored, using the index's typical price weighted by volume.
- The synthetic future is modelled as spot points × quantity, minus carry (6.5% a year), minus ₹700 per round trip.
- A daily candle doesn't show whether its high or its low came first, so the default assumes the adverse move came first.

## Results (24 Nov 2025 to 23 Nov 2026, after costs)
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
- `data/nifty50_daily.csv`: NSE bhavcopy NIFTY 50 daily data, Nov 2024 to Nov 2026 (the first year is indicator warm-up)
- `run_backtest.js`, `variants.json`, `results.txt`: variant comparison
- `dashboard.template.html`, `build_dashboard.js`, `dashboard.html`: offline dashboard
