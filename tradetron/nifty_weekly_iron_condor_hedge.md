# Strategy Spec — NIFTY Weekly Iron Condor Hedge
(Validated with 0 errors by Tradetron's validator; create blocked only by plan limit.)

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
### Entry legs (1 lot each, NRML, Current Week)
- BUY PE  ATM SPOT('NIFTY 50', -14)   (ATM - 700)
- BUY CE  ATM SPOT('NIFTY 50', +14)   (ATM + 700)
### Set runtime var on entry
- entered = 1
### Repair Once: Get Runtime('entered') == 1
- SELL PE ATM SPOT('NIFTY 50', -4)    (ATM - 200)
- SELL CE ATM SPOT('NIFTY 50', +4)    (ATM + 200)
