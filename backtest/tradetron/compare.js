// Compare Tradetron's own backtest (tt_v2_positions.csv) with the bhavcopy daily replica (replica_trades.json)
const fs = require('fs'), path = require('path');
const tt = fs.readFileSync(path.join(__dirname, 'tt_v2_positions.csv'), 'utf8').trim().split('\n').slice(1).map(l => {
  const [side, entry_time, , exit_time, , strike, gross, net, reason] = l.split(','); return { side, entryDate: entry_time.slice(0, 10), exitDate: exit_time.slice(0, 10), net: +net, reason }; });
const rp = JSON.parse(fs.readFileSync(process.argv[2] || path.join(__dirname, 'replica_trades.json'))).trades;
const key = t => t.entryDate + '|' + t.side;
const R = new Map(rp.map(t => [key(t), t])), T = new Map(tt.map(t => [key(t), t]));
const both = tt.filter(t => R.has(key(t))), ttOnly = tt.filter(t => !R.has(key(t))), rpOnly = rp.filter(t => !T.has(key(t)));
const sum = a => a.reduce((x, t) => x + t.net, 0);
const out = { tt: { n: tt.length, wins: tt.filter(t => t.net > 0).length, net: Math.round(sum(tt)) }, replica: { n: rp.length, wins: rp.filter(t => t.net > 0).length, net: sum(rp) },
  matched: both.length, ttOnly: ttOnly.length, replicaOnly: rpOnly.length,
  matchedNetTT: Math.round(sum(both)), matchedNetReplica: sum(both.map(t => R.get(key(t)))),
  sameSign: both.filter(t => Math.sign(t.net) === Math.sign(R.get(key(t)).net)).length,
  rows: [...both.map(t => ({ date: t.entryDate, side: t.side, tt: Math.round(t.net), ttExit: t.reason, rp: R.get(key(t)).net, rpExit: R.get(key(t)).reason, status: 'both' })),
    ...ttOnly.map(t => ({ date: t.entryDate, side: t.side, tt: Math.round(t.net), ttExit: t.reason, rp: null, rpExit: '', status: 'Tradetron only' })),
    ...rpOnly.map(t => ({ date: t.entryDate, side: t.side, tt: null, ttExit: '', rp: t.net, rpExit: t.reason, status: 'replica only' }))].sort((a, b) => a.date < b.date ? -1 : 1) };
if (process.argv.includes('--rows')) out.rows.forEach(r => console.log(r.date, r.side.padEnd(5), r.status.padEnd(14), String(r.tt ?? '').padStart(7), r.ttExit.padEnd(16), String(r.rp ?? '').padStart(7), r.rpExit));
delete out.rows; console.log(JSON.stringify(out));
