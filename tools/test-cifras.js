// Pruebas de cifras: comprueba que el cálculo (FIFO, plusvalías, coste, dividendos) sigue cuadrando
// con los números de control de la hoja "Cartera v3". Se ejecuta antes de cada publicación.
//   node tools/test-cifras.js
// Usa seed.json (copia local de la migración; no se publica). Si no existe, se omite.
const fs = require('fs'), path = require('path'), vm = require('vm');
const root = path.join(__dirname, '..');
const seedPath = path.join(root, 'seed.json');
if (!fs.existsSync(seedPath)) { console.log('Sin seed.json: se omiten las pruebas de cifras.'); process.exit(0); }

const ctx = { window: {}, console };
vm.runInNewContext(fs.readFileSync(path.join(root, 'calc.js'), 'utf8'), ctx);
const C = ctx.window.Calc;
const items = JSON.parse(fs.readFileSync(seedPath, 'utf8'));
const by = k => items.filter(i => i.kind === k && !i.deleted).map(i => i.data);
const txs = by('tx'), divs = by('dividend'), exps = by('expense'), assets = {};
by('asset').forEach(a => { assets[a.id] = a; });
const pos = C.positions(txs);

const realized = y => Object.values(pos).reduce((s, p) => s + (p.realized[y] || 0), 0);
const open = Object.values(pos).filter(p => p.qty > 1e-9).map(p => ({ t: assets[p.asset].ticker, q: p.qty, c: assets[p.asset].type === 'crypto' }));
const stocks = open.filter(o => !o.c).map(o => `${o.t} ${Math.round(o.q)}`).sort().join(', ');
const cryptos = open.filter(o => o.c).map(o => o.t).sort().join(', ');
const costAll = Object.values(pos).reduce((s, p) => s + p.costEur, 0);
const div2026 = divs.filter(d => d.status !== 'pending' && d.date.startsWith('2026')).reduce((s, d) => s + (d.net || 0), 0);
const gastos = exps.reduce((s, e) => s + (e.amount || 0), 0);

const checks = [
  ['Plusvalías realizadas 2026 (FIFO)', realized('2026'), 3431.80, 0.01],
  ['Realizado 2025 (FIFO)', realized('2025'), 2051.48, 0.01],
  ['Realizado 2024 (FIFO)', realized('2024'), 1259.19, 0.01],
  ['Realizado 2023 (FIFO)', realized('2023'), 193.63, 0.01],
  ['Coste de posiciones abiertas', costAll, 31469.04, 0.05],
  ['Dividendos netos cobrados 2026', div2026, 1129.66, 0.01],
  ['Gastos de conectividad DeGiro', gastos, 35.00, 0.01],
];
const expectStocks = 'AGNC 625, BNP 33, IBE 106, KHC 145, MCD 8, NESN 21, O 85, PG 21, T 40, V 6, VID 11, VZ 60';
const expectCrypto = 'BAT, BGB, ETH, PEPE, SHIB, SOL, TRX';

let fail = 0;
for (const [name, got, want, tol] of checks) {
  const ok = Math.abs(got - want) <= tol;
  if (!ok) fail++;
  console.log(`${ok ? 'OK  ' : 'FALLO'} ${name.padEnd(36)} ${got.toFixed(2).padStart(10)}  (esperado ${want.toFixed(2)})`);
}
const okS = stocks === expectStocks, okC = cryptos === expectCrypto;
if (!okS) fail++; if (!okC) fail++;
console.log(`${okS ? 'OK  ' : 'FALLO'} Posiciones de acciones: ${okS ? 'coinciden' : '\n      obtenido: ' + stocks + '\n      esperado: ' + expectStocks}`);
console.log(`${okC ? 'OK  ' : 'FALLO'} Posiciones de cripto: ${okC ? 'coinciden' : '\n      obtenido: ' + cryptos + '\n      esperado: ' + expectCrypto}`);
console.log(fail ? `\n${fail} prueba(s) fallan. No publicar.` : '\nTodas las cifras cuadran.');
process.exit(fail ? 1 : 0);
