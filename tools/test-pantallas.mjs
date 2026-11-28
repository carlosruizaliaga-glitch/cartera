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
  await clic('[data-av=mapa]'); { const n = await page.$$eval('.tile', e => e.length); const o = await overflow(); check('Análisis → MAPA con cuadros de peso', n >= 5 && o.n === 0); await clic('[data-mapa=cap]'); const n2 = await page.$$eval('.tile', e => e.length); check('MAPA por capitalización', n2 >= 3); await clic('[data-mapa=peso]'); }
  await clic('[data-av=graf]'); { const tx = await textoPantalla(), o = await overflow(); check('Análisis → GRÁFICAS (cobros, índice, ganadores, calor)', ['COBROS POR MES', 'RENTA COBRADA', 'FRENTE A UN ÍNDICE', 'GANADORES Y PERDEDORES', 'RENTA POR EMPRESA'].every(x => tx.includes(x)) && o.sw <= o.w, o.n ? JSON.stringify(o.ej) : ''); }
  { // Cuadro de info al pasar el dedo/ratón por las gráficas
    const probar = async (sel, nombre) => {
      await page.evaluate(s => document.querySelector(s).scrollIntoView({ block: 'center' }), sel); await sleep(250);
      const r = await page.evaluate(s => { const b = document.querySelector(s).getBoundingClientRect(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; }, sel);
      await page.mouse.move(r.x - 5, r.y); await page.mouse.move(r.x, r.y); await sleep(200);
      const v = await page.evaluate(() => { const g = document.querySelector('.gtip'); return g && g.style.display === 'block' ? g.innerText : ''; });
      check(`Cuadro de info en ${nombre}`, v.length > 3, v.split(String.fromCharCode(10)).join(' / ').slice(0, 60));
      await page.mouse.move(2, 2); await sleep(150);
    };
    await probar('#app svg[data-lc]', 'gráfica frente a índice');
    await probar('#app .gsvg g[data-tip]', 'barras de cobros');
    await probar('#app .gr[data-tip]', 'ganadores y perdedores');
    await probar('#app .hm span[data-tip]', 'mapa de calor');
  }
  await clic('[data-av=mapa]'); await page.evaluate(() => window.scrollTo(0, 0)); { const v0 = await page.evaluate(() => { const r = document.querySelector('.tile').getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]; }); await page.mouse.move(v0[0] - 3, v0[1]); await page.mouse.move(v0[0], v0[1]); await sleep(200); check('Cuadro de info en el mapa', await page.evaluate(() => document.querySelector('.gtip').style.display === 'block')); await page.mouse.move(2, 2); }
  await clic('[data-mgrp=sector]'); check('MAPA agrupado por sector', (await page.$$eval('.tgrp', e => e.length)) >= 2); await clic('[data-mgrp=none]');
  await clic('[data-av=sug]');
  await page.evaluate(() => {
    const f = (sym, o) => Object.assign({ sym, name: sym + ' Corp', currency: 'USD', sector: 'Healthcare', country: 'United States', price: 100, marketCap: 2e11, high52: 120, low52: 80,
      divRate: 3.2, divYield: 0.032, yield5: 0.026, payout: 0.55, fcfPayout: 0.5, pe: 15, fwdPe: 13, netDebtEbitda: 1.2, currentRatio: 1.4, margin: 0.18, roe: 0.22,
      earningsGrowth: 0.05, target: 125, analysts: 20, avg5: 105, pctile5: 0.25, streak: 12, cuts: 0, cagr5: 0.06, divYears: 12 }, o || {});
    Suggest.setData({ JNJ: f('JNJ'), ZURN: f('ZURN.SW', { currency: 'CHF', sector: 'Financial Services', country: 'Switzerland', price: 480, divRate: 25, divYield: 0.052, netDebtEbitda: null }), BAD: f('BAD', { payout: 1.4, streak: 2 }) });
    UI.render();
  });
  await sleep(500);
  { const t = await textoPantalla(), o = await overflow(); check('Análisis → SUGERENCIAS (reparto, candidatas, descartadas)', ['REPARTO SUGERIDO', 'CANDIDATAS', 'JNJ'].every(x => t.includes(x)) && o.sw <= o.w, o.n ? JSON.stringify(o.ej) : ''); }
  await page.evaluate(() => document.querySelector('[data-sugd]').click()); await sleep(400);
  check('Ficha de candidata con filtros y puntuación', (await textoPantalla()).includes('NOTA'));
  await page.evaluate(() => document.querySelector('[data-close]').click()); await sleep(300);
  await clic('[data-av=plan]'); { const tx = await textoPantalla(), o = await overflow(); check('Análisis → PLAN (objetivos, simulador, salud)', ['OBJETIVOS', 'SIMULADOR', 'SALUD DE TUS DIVIDENDOS'].every(x => tx.includes(x)) && o.sw <= o.w, o.n ? JSON.stringify(o.ej) : ''); }
  // Casos límite de Sugerencias y Plan: sin posiciones, sin datos, todas descartadas, un solo valor
  { const r = await page.evaluate(() => {
      const out = {}, tryIt = (n, fn) => { try { const h = fn(); out[n] = typeof h === 'string' && h.length > 0 && !/NaN|undefined|Infinity/.test(h.replace(/<[^>]*>/g, ' ')); } catch (e) { out[n] = 'ERR ' + e.message; } };
      const m = UI.model(), one = m.rows.slice(0, 1);
      tryIt('sug vacía', () => Suggest.render([])); tryIt('plan vacío', () => Plan.render([]));
      tryIt('sug un valor', () => Suggest.render(one)); tryIt('plan un valor', () => Plan.render(one));
      Suggest.setData({ BAD: { sym: 'BAD', name: 'BAD', currency: 'USD', price: 10, payout: 1.6, streak: 1, cuts: 3, divYears: 2 } });
      tryIt('sug todas descartadas', () => Suggest.render(m.rows));
      Suggest.setData({ NOPRICE: { sym: 'NOPRICE', name: 'X', currency: 'USD', price: null } });
      tryIt('sug sin precio', () => Suggest.render(m.rows));
      tryIt('mejor candidata sin datos', () => { Suggest.best([]); return 'ok'; });
      tryIt('alertas sin posiciones', () => { Plan.alerts([], 0); Plan.alertEvents([], 0); return 'ok'; });
      return out; });
    const malos = Object.entries(r).filter(([, v]) => v !== true && !/ok/.test(String(v))); check('Sugerencias y Plan aguantan casos límite (vacío, un valor, todo descartado, sin precio)', malos.length === 0, JSON.stringify(malos)); }
  // Modo lectura: sin botón +, formularios bloqueados, se sale sin PIN
  await page.evaluate(() => UI.setReadonly(true)); await sleep(400);
  check('Modo lectura oculta el botón + y los importes', await page.evaluate(() => getComputedStyle(document.getElementById('fab')).display === 'none' && !!document.getElementById('roBtn')));
  await page.evaluate(() => window.Forms.openAdd()); await sleep(300);
  check('Modo lectura bloquea los formularios', !(await page.$('.sheet-bg')));
  await page.evaluate(() => document.getElementById('roBtn').click()); await sleep(500);
  check('Se sale del modo lectura', !(await page.$('#roBtn')));
  if (await page.evaluate(() => UI.priv())) await clic('#privBtn');
  const av = await page.evaluate(() => {
    const m = UI.model(), tot = m.rows.reduce((x, r) => x + (r.value || 0), 0);
    localStorage.removeItem('cartera.alertsSeen');
    const a = Plan.alertEvents(m.rows, tot), b = Plan.alertEvents(m.rows, tot);
    return { n: a.length, same: JSON.stringify(a) === JSON.stringify(b), ok: a.every(e => e.k === 'alert' && e.x && /^\d{4}-\d\d-\d\d$/.test(e.d)) };
  });
  check('Alertas para el móvil: formato correcto y estables entre llamadas', av.ok && av.same);
  await clic('[data-av=fiscal]'); check('Análisis → FISCAL', (await textoPantalla()).includes('GANANCIAS Y PÉRDIDAS'));
  await clic('#setBtn');
  for (const sub of [null, 'brokers', 'ret', 'reglas', 'copia', 'sync', 'apariencia', 'telegram', 'seg', 'app']) {
    if (sub) { await clic(`[data-sub=${sub}]`); }
    const t = await textoPantalla(), o = await overflow();
    const esperado = { null: 'SISTEMA', brokers: 'BROKERS', ret: 'RETENCIÓN EN ORIGEN', reglas: 'REGLAS DE LA CARTERA', copia: 'COPIA DE SEGURIDAD', sync: 'SINCRONIZACIÓN', apariencia: 'TAMAÑO DE LETRA', telegram: 'RESUMEN POR TELEGRAM', seg: 'SEGURIDAD', app: 'LA APP' }[sub];
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
  { const t = await textoPantalla(); check('Formulario de compra calcula el total y el peso resultante', t.includes('TOTAL') && /PESO (EMPRESA|ALTO)/.test(t)); }
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
