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
      return r.width && r.right > w + 1 && getComputedStyle(e).position !== 'fixed';
    });
    return { sw: document.documentElement.scrollWidth, w, n: bad.length, ej: bad.slice(0, 2).map(e => e.tagName + '.' + e.className) };
  });
  const textoPantalla = () => page.evaluate(() => (document.getElementById('app').innerText + '\n' + [...document.querySelectorAll('.sheet-bg')].map(e => e.innerText).join('\n')));
  const clic = async sel => { await page.evaluate(s => document.querySelector(s).click(), sel); await sleep(450); };

  // --- Pantallas principales ---
  const pantallas = [['cartera', 'PATRIMONIO'], ['dividendos', 'RENTA ANUAL'], ['calendario', 'INCLUIR SEGUIMIENTO'], ['analisis', 'DISTRIBUCIÓN']];
  for (const [tab, texto] of pantallas) {
    await clic(`[data-tab=${tab}]`);
    const t = await textoPantalla(), o = await overflow();
    check(`Pantalla ${tab.toUpperCase()} se ve y cabe en 360 px`, t.includes(texto) && o.sw <= o.w && o.n === 0, o.n ? JSON.stringify(o.ej) : '');
  }
  await clic('[data-tab=cartera]'); { const t = await textoPantalla(); check('Inicio con KPIs, rendimiento y conclusiones', ['RENTA/AÑO', 'YIELD', 'RENDIMIENTO', 'CONCLUSIONES'].every(x => t.includes(x))); }
  await clic('[data-tab=analisis]');
  await clic('[data-av=rules]'); check('Análisis → REGLAS', (await textoPantalla()).includes('PESO POR EMPRESA'));
  await clic('[data-av=fiscal]'); check('Análisis → FISCAL', (await textoPantalla()).includes('GANANCIAS Y PÉRDIDAS'));
  await clic('#setBtn');
  for (const sub of [null, 'brokers', 'ret', 'reglas', 'copia', 'sync', 'apariencia', 'seg', 'app']) {
    if (sub) { await clic(`[data-sub=${sub}]`); }
    const t = await textoPantalla(), o = await overflow();
    const esperado = { null: 'SISTEMA', brokers: 'BROKERS', ret: 'RETENCIÓN EN ORIGEN', reglas: 'REGLAS DE LA CARTERA', copia: 'COPIA DE SEGURIDAD', sync: 'SINCRONIZACIÓN', apariencia: 'TAMAÑO DE LETRA', seg: 'SEGURIDAD', app: 'LA APP' }[sub];
    check(`Ajustes ${sub || 'menú'} se ve y cabe en 360 px`, t.includes(esperado) && o.sw <= o.w && o.n === 0, o.n ? JSON.stringify(o.ej) : '');
    if (sub) await clic('#subBack');
  }
  await clic('[data-tab=cartera]');

  // --- Ficha de una posición ---
  await page.evaluate(() => document.querySelector('.rows [data-id]').click()); await sleep(800);
  {
    const t = await textoPantalla(), o = await overflow();
    check('Ficha de posición con gráfica y datos', t.includes('MI POSICIÓN') && !!(await page.$('.sheet-bg svg')) && o.n === 0);
    await page.evaluate(() => document.querySelector('[data-close]').click()); await sleep(300);
  }

  // --- Formulario de compra ---
  await clic('#fab'); await clic('[data-k=buy]');
  await page.evaluate(() => { const i = document.getElementById('pq'); i.value = 'ko'; i.dispatchEvent(new Event('input')); document.querySelector('.pick[data-id]').click(); });
  await sleep(500);
  await page.evaluate(() => { const q = document.getElementById('qty'); q.value = '10'; q.dispatchEvent(new Event('input')); });
  await sleep(300);
  check('Formulario de compra calcula el total', (await textoPantalla()).includes('TOTAL'));
  await page.evaluate(() => document.querySelector('[data-close]').click()); await sleep(300);

  // --- Modo privado: no debe verse ningún importe grande en euros ---
  await clic('#privBtn');
  let fugas = [];
  for (const [tab] of pantallas) {
    await clic(`[data-tab=${tab}]`);
    const lineas = (await textoPantalla()).split('\n').filter(l => /\d{1,3}(\.\d{3})*,\d{2}\s?€/.test(l) && !/×|\/acc|por acci[oó]n|cobrar/.test(l));
    fugas = fugas.concat(lineas.map(l => `${tab}: ${l.trim()}`));
  }
  check('Modo privado oculta los importes en todas las pantallas', fugas.length === 0, fugas.slice(0, 2).join(' | '));
  await clic('#privBtn');

  // --- PIN: bloquea al abrir y desbloquea con el PIN ---
  await page.evaluate(async () => { UI.pin.save(await UI.pin.make('1234')); });
  await page.reload({ waitUntil: 'networkidle0' }); await sleep(1500);
  check('Con PIN, la app arranca bloqueada', !!(await page.$('#lock')));
  await page.evaluate(() => { for (const k of ['9', '9', '9', '9', 'ok']) document.querySelector(`[data-k="${k}"]`).click(); }); await sleep(500);
  check('PIN incorrecto no desbloquea', !!(await page.$('#lock')));
  await page.evaluate(() => { for (const k of ['1', '2', '3', '4', 'ok']) document.querySelector(`[data-k="${k}"]`).click(); }); await sleep(800);
  check('PIN correcto desbloquea', !(await page.$('#lock')));
  await page.evaluate(() => UI.pin.save(null));

  check('Sin errores en la consola durante toda la prueba', errors.length === 0, errors.slice(0, 2).join(' | '));
} finally {
  await browser.close();
  server.close();
}
const fallos = results.filter(r => !r.ok).length;
console.log(fallos ? `\n${fallos} prueba(s) de pantallas fallan. No publicar.` : `\nTodas las pantallas pasan (${results.length} pruebas).`);
process.exit(fallos ? 1 : 0);
