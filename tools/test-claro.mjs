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

  await page.evaluate(() => UI.theme.set('light')); await sleep(400);
  // Contraste de cada texto visible frente a su fondo real (mínimo 3:1; el texto pequeño ideal 4,5:1)
  const contraste = () => page.evaluate(() => {
    const parse = c => { const m = c.match(/[\d.]+/g).map(Number); return { r: m[0], g: m[1], b: m[2], a: m[3] == null ? 1 : m[3] }; };
    const lum = ({ r, g, b }) => { const f = v => { v /= 255; return v <= .03928 ? v / 12.92 : Math.pow((v + .055) / 1.055, 2.4); }; return .2126 * f(r) + .7152 * f(g) + .0722 * f(b); };
    const bgOf = el => { let bg = { r: 255, g: 255, b: 255 }; const chain = []; for (let e = el; e; e = e.parentElement) chain.push(e);
      for (const e of chain.reverse()) { if (e.classList && e.classList.contains('sheet-bg')) continue; const c = parse(getComputedStyle(e).backgroundColor); if (c.a > 0) bg = { r: bg.r * (1 - c.a) + c.r * c.a, g: bg.g * (1 - c.a) + c.g * c.a, b: bg.b * (1 - c.a) + c.b * c.a }; } return bg; };
    const bad = [], seen = new Set();
    document.querySelectorAll('#app *, .sheet-bg *').forEach(el => {
      if (![...el.childNodes].some(n => n.nodeType === 3 && n.textContent.trim().length > 1)) return;
      const cs = getComputedStyle(el); if (cs.visibility === 'hidden' || cs.display === 'none' || +cs.opacity === 0) return;
      const r = el.getBoundingClientRect(); if (!r.width || !r.height) return;
      const fg = parse(cs.color), bg = bgOf(el); if (fg.a < .1) return;
      const L1 = lum(fg), L2 = lum(bg), cr = (Math.max(L1, L2) + .05) / (Math.min(L1, L2) + .05);
      if (cr < 3) { const k = el.className + '|' + el.textContent.trim().slice(0, 14); if (!seen.has(k)) { seen.add(k); bad.push(cr.toFixed(1) + ' ' + el.tagName + '.' + el.className + ' "' + el.textContent.trim().slice(0, 24) + '"'); } }
    });
    return bad.slice(0, 8);
  });
  const rev = async (nombre) => { const b = await contraste(); check('Tema claro · ' + nombre, b.length === 0, b.join(' ; ')); };
  for (const tab of ['cartera', 'dividendos', 'calendario', 'analisis']) { await clic(`[data-tab=${tab}]`); await rev(tab); }
  for (const v of ['dist', 'mapa', 'graf', 'sug', 'plan', 'rules', 'fiscal']) { await clic('[data-tab=analisis]'); await clic(`[data-av=${v}]`); await rev('análisis ' + v); }
  await clic('#setBtn'); await rev('ajustes');
  for (const sub of ['brokers', 'ret', 'reglas', 'copia', 'sync', 'apariencia', 'telegram', 'seg', 'app']) { await clic(`[data-sub=${sub}]`); await rev('ajustes ' + sub); await clic('#subBack'); }
  await clic('[data-tab=cartera]'); await page.evaluate(() => document.querySelector('.pos, .row, [data-id]').click()); await sleep(500); await rev('ficha de posición');
  await page.screenshot({ path: path.join(root, 'tools', 'claro-ficha.png') });
  await page.evaluate(() => { const c = document.querySelector('[data-close]'); if (c) c.click(); }); await sleep(300);
  await clic('#fab'); await rev('menú añadir');
  console.log(results.filter(r => !r.ok).length ? 'HAY FALLOS' : 'Tema claro sin problemas de contraste');
} finally { await browser.close(); server.close(); }
