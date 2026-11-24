// node build_dashboard.js -> dashboard.html (self-contained, works offline)
const fs = require('fs'), path = require('path');
const rd = f => fs.readFileSync(path.join(__dirname, f), 'utf8');
const rows = rd('data/nifty50_daily.csv').trim().split('\n').slice(1).map(l => {
  const [date, o, h, lo, c, v] = l.split(','); return { date, o: +o, h: +h, l: +lo, c: +c, v: +v };
});
const html = rd('dashboard.template.html')
  .replace('/*__ENGINE__*/', () => rd('engine.js'))
  .replace('/*__DATA__*/', () => JSON.stringify(rows))
  .replace('/*__META__*/', () => JSON.stringify({ first: rows[0].date, last: rows[rows.length - 1].date }));
fs.writeFileSync(path.join(__dirname, 'dashboard.html'), html);
console.log('dashboard.html', (html.length / 1024).toFixed(0) + ' KB');
