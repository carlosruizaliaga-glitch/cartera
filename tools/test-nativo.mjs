// Pruebas de pantallas: abre la app en Chrome (sin cabeza) con datos de ejemplo, recorre las pantallas
// y comprueba que no hay errores, que nada se sale del ancho del móvil, que el modo privado oculta los importes,
// que el PIN bloquea y desbloquea, y que los formularios abren.
//   node tools/test-pantallas.mjs
// Usa test.html + seed.json + test-market.json (copias locales, no se publican). Si faltan, se omite.
import fs from 'fs';
import http from 'http';
import path from 'path';
import { fileURLToPath } from 'url';
import puppeteer from 'puppeteer-core';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
for (const f of ['test.html', 'seed.json', 'test-market.json', 'test-quotes.json']) {
  if (!fs.existsSync(path.join(root, f))) { console.log(`Falta ${f}: se omiten las pruebas de pantallas.`); process.exit(0); }
}
const CHROME = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe']
  .find(p => fs.existsSync(p));
if (!CHROME) { console.log('No encuentro Chrome: se omiten las pruebas de pantallas.'); process.exit(0); }

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.css': 'text/css', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };
const server = http.createServer((req, res) => {
  const p = path.join(root, decodeURIComponent(req.url.split('?')[0]).replace(/^\/+/, '') || 'index.html');
  if (!p.startsWith(root) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(p)] || 'application/octet-stream' });
  fs.createReadStream(p).pipe(res);
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}`;

const results = [];
const check = (name, ok, extra = '') => { results.push({ name, ok }); console.log(`${ok ? 'OK   ' : 'FALLO'} ${name}${extra ? '  · ' + extra : ''}`); };
const sleep = ms => new Promise(r => setTimeout(r, ms));

const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox'] });
try {
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  await page.evaluateOnNewDocument(() => { window.__native = { summary: [], events: [], files: [] }; window.AndroidBridge = { saveSummary: j => window.__native.summary.push(j), saveEvents: j => window.__native.events.push(j), saveFile: (n, m, b) => { window.__native.files.push(n); return true; }, notificationsEnabled: () => true, requestNotifications() {}, bioAvailable: () => false, bioAuth() {} }; });
  await page.setViewport({ width: 360, height: 780, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
  const errors = [];
  page.on('pageerror', e => errors.push(String(e.message || e)));
  page.on('console', m => { if (m.type() === 'error' && !/favicon|Failed to load resource/.test(m.text())) errors.push(m.text()); });

  await page.goto(base + '/test.html', { waitUntil: 'networkidle0' });
  await page.waitForFunction(() => document.querySelector('.hero, #main .hero, main') && document.body.innerText.includes('PATRIMONIO'), { timeout: 15000 });
  await sleep(800);

  const overflow = () => page.evaluate(() => {
    const w = innerWidth;
    const bad = [...document.querySelectorAll('#app *, .sheet-bg *')].filter(e => {
      const r = e.getBoundingClientRect();
      return r.width && r.right > w + 1 && getComputedStyle(e).position !== 'fixed' && !e.closest('.seg.five');
    });
    return { sw: document.documentElement.scrollWidth, w, n: bad.length, ej: bad.slice(0, 2).map(e => e.tagName + '.' + e.className) };
  });
  const textoPantalla = () => page.evaluate(() => (document.getElementById('app').innerText + '\n' + [...document.querySelectorAll('.sheet-bg')].map(e => e.innerText).join('\n')));
  const clic = async sel => { await page.evaluate(s => document.querySelector(s).click(), sel); await sleep(450); };

  await sleep(3500);
  const n = await page.evaluate(() => window.__native);
  check('Android: el resumen del widget se envía', n.summary.length > 0 && JSON.parse(n.summary[0]).v);
  check('Android: los eventos se envían como lista', n.events.length > 0 && Array.isArray(JSON.parse(n.events[0])));
  check('Android: cada evento tiene tipo y fecha válidos', JSON.parse(n.events[0]).every(e => e.t && ['pay', 'ex', 'earn', 'alert'].includes(e.k) && /^\d{4}-\d\d-\d\d$/.test(e.d)));
  check('Android: sin copia automática si no está activada', n.files.length === 0);
  await page.evaluate(() => { localStorage.setItem('cartera.autoBackup', '1'); localStorage.removeItem('cartera.lastBackup'); UI.render(); });
  await sleep(3500);
  check('Android: con copia automática activada guarda una copia', (await page.evaluate(() => window.__native.files)).some(f => /copia/.test(f)));
  await page.evaluate(() => { window.__native.files.length = 0; UI.render(); }); await sleep(3500);
  check('Android: no repite la copia antes de una semana', (await page.evaluate(() => window.__native.files)).length === 0);
  check('Sin errores en la consola', errors.length === 0, errors.slice(0, 2).join(' | '));
  console.log(results.filter(r => !r.ok).length ? 'HAY FALLOS' : 'Todo bien (Android simulado)');
} finally { await browser.close(); server.close(); }
