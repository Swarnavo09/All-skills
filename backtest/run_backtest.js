// node run_backtest.js  -> prints variant comparison, writes results/*.json
const fs = require('fs'), path = require('path');
const Engine = require('./engine.js');
const csv = fs.readFileSync(path.join(__dirname, 'data/nifty50_daily.csv'), 'utf8').trim().split('\n').slice(1);
const bars = csv.map(l => { const [date, o, h, l2, c, v] = l.split(','); return { date, o: +o, h: +h, l: +l2, c: +c, v: +v }; });

const variants = JSON.parse(fs.readFileSync(path.join(__dirname, 'variants.json'), 'utf8'));
const fmt = x => (x < 0 ? '-' : '') + 'Rs ' + Math.abs(Math.round(x)).toLocaleString('en-IN');
const out = {};
for (const v of variants) {
  const r = Engine.run(bars, v.params);
  const s = r.stats;
  out[v.id] = { s, trades: r.trades.length };
  console.log(`\n== ${v.id}: ${v.name}`);
  console.log(`trades ${s.trades} | net ${fmt(s.net)} | win ${(s.winRate*100).toFixed(1)}% | PF ${s.profitFactor.toFixed(2)} | avgW ${fmt(s.avgWin)} avgL ${fmt(s.avgLoss)} | maxDD ${fmt(s.maxDD)} | ret ${(s.returnPct*100).toFixed(1)}% | costs ${fmt(s.costs)} | skipped(expiry) ${r.skipped.length}`);
  console.log('  by side', JSON.stringify(s.bySide));
  console.log('  by exit', JSON.stringify(s.byReason));
  if (process.argv.includes('-v')) r.trades.forEach(t => console.log(`  ${t.side.padEnd(5)} ${t.entryDate} ${t.entry} -> ${t.exitDate} ${t.exit} pts ${t.points} net ${t.net} ${t.reason}`));
}
