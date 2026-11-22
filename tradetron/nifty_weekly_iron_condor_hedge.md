# Strategy Spec — Non-Directional NIFTY Weekly Strategy
Tradetron template 999509246 (created and saved).

## METADATA
| Field | Value |
|---|---|
| Strategy name | NIFTY Weekly Iron Condor Hedge |
| Default underlying | NIFTY 50 |
| Price execution | Avg of Bid/Ask |
| Trailing SL (Advanced) | Move to cost at profit 2000, profit increase 500, SL increase 500 |
| Reactivate every | 1080 minutes |

## INIT VARS
| Name | Default |
|---|---|
| entered | Number(0) |

## UNIVERSAL EXIT  (OR)
- ( Today('NSE') == Current Week Expiry('NIFTY 50',0) AND Time('NSE') >= 1500 )
- PNL() <= -6000

## SET 1: Iron Condor
### Entry (AND)
- Time('NSE') >= 930
- Time('NSE') < 945
- Week Day('NSE') == 5
- Days Difference (D2-D1)(Today('NSE'), Current Week Expiry('NIFTY 50',0)) >= 2
- Open positions('NIFTY 50') == 0
- Position(ADX(Symbol(Instrument Name('NFO,NIFTY 50,,,,,'), 'day', 'All'), 14), -1) < 22   (market filter: only trade when NIFTY is not trending)
### Entry legs (1 lot each, NRML, Current Week)
- BUY PE  ATM SPOT('NIFTY 50', -14)   (ATM - 700)
- BUY CE  ATM SPOT('NIFTY 50', +14)   (ATM + 700)
### Set runtime var on entry
- entered = 1
### Repair Once: Get Runtime('entered') == 1
- SELL PE ATM SPOT('NIFTY 50', -4)    (ATM - 200)
- SELL CE ATM SPOT('NIFTY 50', +4)    (ATM + 200)

## Why the ADX filter
Backtest Dec 2023 - Nov 2026 (1 lot): every Friday = 151 trades, net 1,94,131, max drawdown -38,600.
With daily ADX(14) < 22 = 85 trades, net 1,60,820, max drawdown -17,200, win rate 71%.
