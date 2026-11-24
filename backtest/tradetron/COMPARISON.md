# Tradetron "NIFTY Futures Weekly v2" vs NSE bhavcopy replica

**Strategy:** Tradetron template `999498586`. The Tradetron report comes from the existing finished run `ttbt-999410710261121` (17 Oct 2024 – 17 Oct 2026); reading it cost nothing and no new paid run was started.

## Strategy as fetched from Tradetron
- **Signal:** 1-hour NIFTY current-month futures, using the previous completed candle. Long when close > Supertrend (SMA ATR, 10,3), close > EMA21, EMA9 > EMA21, EMA18 > EMA42 and close > VWAP. Short is the mirror image.
- **Entry:** LTP breaks the signal candle's high (long) or low (short), between 10:00 and 12:00. Longs only on Thursday, shorts on Thursday and Friday, never on expiry day. Positions are 2 lots of a current-week ATM synthetic (long: buy CE + sell PE; short: buy PE + sell CE). At most 2 cycles per day.
- **Exit:**
  - 1-hour close crosses SMA18
  - Strategy P&L ≥ ₹40,000 or ≤ −₹8,000
  - Trailing stop: moves to cost at +₹16K, then up ₹1.6K for every ₹1.6K more profit
  - Square-off at 15:00 on weekly expiry day

## Results side by side
| | Tradetron (1-hour futures and real option prices) | Bhavcopy replica (daily index candles) |
|---|---|---|
| Positions | 40 | 22 |
| Winning positions | 16 (40%) | 7 (32%) |
| Net P&L (130 qty, after costs) | **₹3,42,570** | **₹1,08,976** |
| Short / long P&L | ₹3,22,825 / ₹19,744 | ₹91,564 / ₹17,412 |
| Year 1 / Year 2 | ₹2,50,782 / ₹91,787 | ₹82,846 / ₹26,130 |
| Max drawdown | ₹79,566 (15.9% of ₹5L) | ₹71,211 (closed trades) |

**Trade-by-trade:**
- 11 of Tradetron's 40 trades also appear in the replica on the same day and side. 8 of those 11 end with the same result sign.
- 29 Tradetron trades have no daily equivalent, and the replica has 11 trades Tradetron never took.
- Variants (Wilder ATR for Supertrend, weekly VWAP) move the replica to ₹1.38–1.49L with 10–12 matches. None comes close to Tradetron.

**Data check:** all 40 Tradetron ATM strikes fall inside that day's bhavcopy high–low range, so both sources see the same NIFTY prices.

## Why the reports differ
1. **Timeframe.** Tradetron re-checks the five conditions on every 1-hour candle and enters on an hourly breakout. A daily candle collapses six hourly candles into one, so most hourly setups never exist on the daily chart and some daily setups never exist hourly. This one difference accounts for most of the mismatch.
2. **Option prices vs index points.** Tradetron prices the actual ATM CE/PE, so IV changes and gaps flow straight into P&L. Its best trade, the 4 Apr 2025 short, made ₹1,24,165 because the 7 Apr gap blew far past the ₹40K target. The replica caps a target at ₹40K unless the gap is visible in the index open.
3. **Intraday order.** On daily candles the stop/target order is unknown, so the replica assumes the worse case. The ₹8K stop is only about 62 points on 130 qty, so this matters on almost every trade.
4. **Not modellable on daily data:** the 10:00–12:00 window, the second cycle per day, and the exact 15:00 expiry square-off.
5. **Warm-up.** Bhavcopy data starts 7 Oct 2024, so EMA42 isn't ready for the replica's first weeks. Tradetron's Oct and Dec 2024 trades are missed for that reason alone.

## Things to note in the Tradetron report itself
- **Concentration:** two gap trades (4 Apr 2025 and 27 Feb 2026) made ₹2,01,176, which is 59% of the net. Without them the strategy earns about ₹1.41L over two years.
- **Year 2 was much weaker** (₹91,787 against ₹2,50,782). The drawdown that started in March 2026 had not recovered by the end of the run.
- **Tradetron's own caveats:** COVERAGE_PARTIAL (4 sessions without data) and a thin long-side sample (9 long positions).

## Files
- `tt_v2_fills.csv`: Tradetron's 80 leg fills
- `tt_v2_positions.csv`: the same fills paired into 40 positions
- `tt_replica.js`: the daily replica (`--rma` and `--weekly-vwap` give the variants)
- `replica_trades.json`: replica output
- `compare.js`: trade-by-trade comparison (`node tradetron/compare.js tradetron/replica_trades.json --rows`)
