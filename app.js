(function () {
  'use strict';
  const S = window.Store, M = window.Market, C = window.Calc;
  const $ = (sel, el) => (el || document).querySelector(sel);
  const app = $('#app');

  // ---------- Preferencias locales (solo de este móvil) ----------
  const pref = (k, def) => { try { const v = localStorage.getItem('cartera.pref.' + k); return v == null ? def : JSON.parse(v); } catch (e) { return def; } };
  const setPref = (k, v) => { try { localStorage.setItem('cartera.pref.' + k, JSON.stringify(v)); } catch (e) { /* sin almacenamiento */ } };
  const ui = { tab: 'cartera', filter: pref('filter', 'all'), range: pref('range', '1M'), pct: pref('pct', false), scrub: null };

  // ---------- Formato español ----------
  const grp = s => s.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  function fnum(n, dec) {
    if (n == null || !isFinite(n)) return '—';
    dec = dec == null ? 2 : dec;
    const [i, f] = Math.abs(n).toFixed(dec).split('.');
    return (n < 0 && Math.abs(n) >= Math.pow(10, -dec) / 2 ? '-' : '') + grp(i) + (f ? ',' + f : '');
  }
  const eur = (n, dec) => fnum(n, dec) + ' €';
  const sgn = n => n > 1e-9 ? '+' : n < -1e-9 ? '−' : '';
  const sEur = (n, dec) => sgn(n) + eur(Math.abs(n), dec);
  const sPct = n => n == null || !isFinite(n) ? '—' : (Math.abs(n) < 5e-5 ? '' : sgn(n)) + fnum(Math.abs(n) * 100, 2) + '%';
  const cls = n => n > 1e-9 ? 'up' : n < -1e-9 ? 'down' : 'flat';
  const SYM = { EUR: '€', USD: '$', GBP: '£', CHF: 'CHF', HKD: 'HK$' };
  function price(n, cur) {
    if (n == null || !isFinite(n)) return '—';
    const neg = n < 0 ? '−' : '';
    n = Math.abs(n);
    const dec = n >= 1 || n === 0 ? 2 : n >= 0.01 ? 4 : 8;
    let s = fnum(n, dec);
    if (dec > 2) { s = s.replace(/0+$/, ''); if ((s.split(',')[1] || '').length < 2) s = fnum(n, 2); }
    return cur === 'USD' ? neg + '$' + s : neg + s + ' ' + (SYM[cur] || cur || '');
  }
  const qtyFmt = q => Math.abs(q - Math.round(q)) < 1e-9 ? grp(String(Math.round(q))) : fnum(q, q < 1 ? 8 : 4).replace(/0+$/, '').replace(/,$/, '');
  const fdate = iso => iso ? iso.slice(8, 10) + '/' + iso.slice(5, 7) + '/' + iso.slice(0, 4) : '—';
  const madrid = ts => new Date(ts).toLocaleString('es-ES', { timeZone: 'Europe/Madrid', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
  const today = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Madrid' });
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const initials = t => (t || '?').replace(/[^A-Za-z0-9]/g, '').slice(0, 4).toUpperCase();

  function toast(msg) {
    const t = document.createElement('div');
    t.className = 'toast'; t.textContent = msg;
    document.body.appendChild(t);
    setTimeout(() => t.remove(), 2600);
  }
  function sheet(html) {
    const bg = document.createElement('div');
    bg.className = 'sheet-bg';
    bg.innerHTML = `<div class="sheet">${html}</div>`;
    bg.addEventListener('click', e => { if (e.target === bg || e.target.closest('[data-close]')) bg.remove(); });
    document.body.appendChild(bg);
    return bg;
  }

  // ---------- Modelo ----------
  let cache = { key: null };
  function model() {
    const key = S.version() + '|' + M.version();
    if (cache.key === key) return cache;
    const assets = S.list('asset');
    const byId = {}; assets.forEach(a => { byId[a.id] = a; });
    const txs = S.list('tx').filter(t => byId[t.asset]);
    const pos = C.positions(txs);
    const rows = [];
    Object.values(pos).forEach(p => {
      if (p.qty <= 0) return;
      const a = byId[p.asset];
      let q = M.quote(a), stale = false;
      if (!q) { // sin cotización: último cierre conocido
        const h = M.history(a), days = Object.keys(h.closes).sort();
        const last = days[days.length - 1];
        q = last ? { price: h.closes[last], prev: h.closes[days[days.length - 2]] || h.closes[last], currency: h.currency, ts: Date.parse(last) } : null;
        stale = true;
      }
      const r = q ? M.rate(q.currency) : null;
      const value = q && r ? p.qty * q.price / r : null;
      const day = q && r && q.prev != null ? p.qty * (q.price - q.prev) / r : 0;
      rows.push({ a, p, q, stale, value, day, dayPct: value ? day / (value - day) : null,
        pl: value != null ? value - p.costEur : null, plPct: value != null && p.costEur > 0 ? (value - p.costEur) / p.costEur : null });
    });
    rows.sort((x, y) => (y.value || 0) - (x.value || 0));
    cache = { key, assets, byId, txs, pos, rows, series: {} };
    return cache;
  }
  const inFilter = (a, f) => f === 'all' || (f === 'crypto' ? a.type === 'crypto' : a.type !== 'crypto');

  function seriesFor(mdl, f) {
    const hk = f;
    if (mdl.series[hk]) return mdl.series[hk];
    const txs = mdl.txs.filter(t => inFilter(mdl.byId[t.asset], f));
    const s = C.series(txs, mdl.byId, a => M.history(a), M.fxHistory(), today(), a => M.quote(a));
    return (mdl.series[hk] = s);
  }

  // ---------- Cabecera / navegación ----------
  function syncDot() {
    const st = S.status();
    const c = st === 'ok' ? 'ok' : (st === 'syncing' || st === 'idle') ? 'warn' : 'err';
    const txt = st === 'offline' ? 'OFFLINE' : st === 'bad_secret' ? 'CÓDIGO' : st === 'error' ? 'ERROR' : S.pending() ? S.pending() + ' PEND.' : 'SYNC';
    return `<span class="dot ${c}"></span>${txt}`;
  }
  const pendingCount = () => S.list('dividend').filter(d => d.status === 'pending').length;
  function shell(inner) {
    const tabs = [['cartera', '▤', 'CARTERA'], ['dividendos', '$', 'DIVIDENDOS'], ['calendario', '▦', 'CALENDARIO'], ['analisis', '◧', 'ANÁLISIS']];
    app.innerHTML = `
      <header class="top">
        <div class="brand"><b>&gt;</b> CARTERA CARLOS</div><div class="sp"></div>
        <button class="iconbtn" id="syncBtn">${syncDot()}</button>
        <button class="iconbtn" id="setBtn" aria-label="Ajustes">⚙</button>
      </header>
      <div id="ptr"></div>
      <main id="main">${inner}</main>
      <nav class="tabs">${tabs.map((t, i) => (i === 2 ? '<button class="fab" id="fab" aria-label="Añadir">+</button>' : '') +
        `<button data-tab="${t[0]}" class="${ui.tab === t[0] ? 'on' : ''}"><span class="ic">${t[1]}</span>${t[2]}${t[0] === 'dividendos' && pendingCount() ? `<i class="badge">${pendingCount()}</i>` : ''}</button>`).join('')}</nav>`;
    app.querySelectorAll('[data-tab]').forEach(b => b.onclick = () => { ui.tab = b.dataset.tab; ui.scrub = null; render(); window.scrollTo(0, 0); });
    $('#syncBtn').onclick = () => { S.syncNow(); refreshMarket(true); };
    $('#setBtn').onclick = () => { ui.tab = 'ajustes'; render(); };
    $('#fab').onclick = openAdd;
  }

  // ---------- CARTERA ----------
  const RANGES = [['1D', '1D'], ['1S', '1S'], ['1M', '1M'], ['YTD', 'YTD'], ['1A', '1A'], ['TODO', 'TODO']];
  function rangeStart(r, t) {
    if (r === '1S') return C.addDays(t, -7);
    if (r === '1M') return C.addDays(t, -30);
    if (r === 'YTD') return C.addDays(t.slice(0, 4) + '-01-01', -1);
    if (r === '1A') return C.addDays(t, -365);
    return null;
  }

  // Ganancia del periodo sin contar lo que aportaste/retiraste, y % por Modified Dietz.
  function rangeStats(pts, end) {
    if (!pts.length || end < 1) return { chg: 0, pct: 0 };
    const v0 = pts[0].v;
    let flows = 0, weighted = 0, pos = 0;
    for (let i = 1; i <= end; i++) {
      const f = pts[i].flow;
      flows += f; weighted += f * (end - i) / end; if (f > 0) pos += f;
    }
    const chg = pts[end].v - v0 - flows;
    let base = v0 + weighted;
    if (base <= 0) base = v0 + pos;
    return { chg, pct: base > 0 ? chg / base : 0 };
  }

  const SEGS = [['all', 'TODO'], ['stock', 'ACCIONES'], ['crypto', 'CRIPTO'], ['watch', 'SEGUIM.']];
  const segHtml = f => `<div class="seg">${SEGS.map(o => `<button data-f="${o[0]}" class="${f === o[0] ? 'on' : ''}">${o[1]}</button>`).join('')}</div>`;
  const bindSeg = () => app.querySelectorAll('[data-f]').forEach(b => b.onclick = () => { ui.filter = b.dataset.f; setPref('filter', ui.filter); render(); });

  // ---------- WATCHLIST (empresas que sigues sin tener acciones) ----------
  let watchLoaded = 0;
  function renderWatch() {
    const mdl = model();
    const held = new Set(mdl.rows.map(r => r.a.id));
    const list = mdl.assets.filter(a => !held.has(a.id)).sort((x, y) => x.ticker.localeCompare(y.ticker));
    if (Date.now() - watchLoaded > 15 * 60 * 1000 && S.secret()) {
      watchLoaded = Date.now();
      M.load(list).catch(() => { watchLoaded = 0; });
    }
    shell(`${segHtml('watch')}
      <h2><span>SEGUIMIENTO · ${list.length}</span><span class="tog" id="addw">+ AÑADIR</span></h2>
      <div class="rows">${list.map(a => {
        const q = M.quote(a);
        const ch = q && q.prev ? (q.price - q.prev) / q.prev : null;
        const y = q && a.divAnnual && a.type !== 'crypto' ? a.divAnnual / q.price : null;
        return `<div class="row" data-id="${esc(a.id)}">${logoHtml(a, q)}
          <div class="mid"><div class="tk">${esc(a.ticker)}</div><div class="nm ellipsis">${esc(a.name)}</div></div>
          <div class="rt"><div class="val">${q ? price(q.price, q.currency) : '<span class="dim">…</span>'}</div>
            <div class="sub"><span class="${cls(ch)}">${ch != null ? sPct(ch) : ''}</span>${y ? ' <span class="dim">RPD</span> <span class="yellow">' + fnum(y * 100, 1) + '%</span>' : ''}</div></div></div>`;
      }).join('')}</div>`);
    bindSeg();
    $('#addw').onclick = () => window.Forms.openAssetForm();
    app.querySelectorAll('.rows [data-id]').forEach(el => el.onclick = () => openAsset(el.dataset.id));
  }

  function renderCartera() {
    if (ui.filter === 'watch') return renderWatch();
    const mdl = model();
    const f = ui.filter;
    const rows = mdl.rows.filter(r => inFilter(r.a, f));
    const total = rows.reduce((s, r) => s + (r.value || 0), 0);
    const day = rows.reduce((s, r) => s + (r.day || 0), 0);
    const cost = rows.reduce((s, r) => s + r.p.costEur, 0);
    const dayPct = total - day ? day / (total - day) : 0;

    // Serie del gráfico para el rango elegido
    const t = today();
    let pts;
    if (ui.range === '1D') pts = [{ d: 'AYER', v: total - day, flow: 0 }, { d: 'AHORA', v: total, flow: 0 }];
    else {
      const all = seriesFor(mdl, f).slice();
      if (all.length) all[all.length - 1] = Object.assign({}, all[all.length - 1], { v: total });
      const from = rangeStart(ui.range, t);
      pts = from ? all.filter(p => p.d >= from) : all;
    }
    const { chg: rchg, pct: rpct } = rangeStats(pts, pts.length - 1);

    const lastQ = M.lastQuotes();
    const err = M.error();
    const asof = lastQ ? `PRECIOS ${madrid(lastQ)}${err ? ' · <span class="down">' + esc(err.toUpperCase()) + ' · ÚLTIMO GUARDADO</span>' : ''}` : (M.busy() ? 'CARGANDO PRECIOS…' : 'SIN PRECIOS TODAVÍA');
    const scrub = ui.scrub;

    shell(`
      ${segHtml(f)}
      <section class="hero">
        <div class="label" id="hLabel">${scrub ? esc(scrub.label) : 'PATRIMONIO'}</div>
        <div class="big" id="hBig">${eur(scrub ? scrub.v : total)}</div>
        <div class="chg" id="hChg">${scrub ? scrub.chg : `<span class="${cls(day)}">${sEur(day)} (${sPct(dayPct)})</span> <span class="muted">HOY</span>`}</div>
        ${ui.range !== '1D' ? `<div class="chg"><span class="${cls(rchg)}">${sEur(rchg)} (${sPct(rpct)})</span> <span class="muted">${ui.range}</span></div>` : ''}
        <div class="asof">${asof}</div>
      </section>
      <div class="chart" id="chart">${chartSvg(pts, rchg)}</div>
      <div class="ranges">${RANGES.map(r => `<button data-r="${r[0]}" class="${ui.range === r[0] ? 'on' : ''}">${r[1]}</button>`).join('')}</div>
      <h2><span>POSICIONES · ${rows.length}</span><span class="tog" id="tog">${ui.pct ? '%' : '€'}</span></h2>
      <div class="rows">${rows.map(r => posRow(r, total)).join('') || '<div class="soon">SIN POSICIONES</div>'}</div>
      <div class="kv" style="margin:16px 0 4px">
        <div class="k">COSTE</div><div class="v">${eur(cost)}</div>
        <div class="k">P/L LATENTE</div><div class="v ${cls(total - cost)}">${sEur(total - cost)} (${sPct(cost ? (total - cost) / cost : 0)})</div>
      </div>`);

    bindSeg();
    app.querySelectorAll('[data-r]').forEach(b => b.onclick = () => { ui.range = b.dataset.r; setPref('range', ui.range); render(); });
    $('#tog').onclick = () => { ui.pct = !ui.pct; setPref('pct', ui.pct); render(); };
    app.querySelectorAll('.rows [data-id]').forEach(el => {
      el.onclick = e => {
        if (e.target.closest('.rt')) { ui.pct = !ui.pct; setPref('pct', ui.pct); render(); return; }
        openAsset(el.dataset.id);
      };
    });
    bindScrub(pts, total, day, dayPct);
  }

  function logoHtml(a, q) {
    const src = a.type === 'crypto' ? (q && q.image) : (a.yahoo ? 'https://assets.parqet.com/logos/symbol/' + encodeURIComponent(a.yahoo) + '?format=png' : null);
    if (!src || a.logoFail) return `<div class="logo txt">${esc(initials(a.ticker))}</div>`;
    return `<div class="logo"><img src="${esc(src)}" alt="" loading="lazy" data-fb="${esc(initials(a.ticker))}"></div>`;
  }
  function posRow(r, total) {
    const a = r.a;
    const w = total ? (r.value || 0) / total : 0;
    const dayTxt = ui.pct ? sPct(r.dayPct) : sEur(r.day);
    const plTxt = ui.pct ? sPct(r.plPct) : sEur(r.pl);
    return `<div class="row" data-id="${esc(a.id)}">
      ${logoHtml(a, r.q)}
      <div class="mid">
        <div class="tk">${esc(a.ticker)}${r.stale ? '<span class="tag yellow">CACHÉ</span>' : ''}</div>
        <div class="nm ellipsis">${esc(a.name)}</div>
        <div class="nm">${qtyFmt(r.p.qty)} × ${r.q ? price(r.q.price, r.q.currency) : '—'} · ${fnum(w * 100, 1)}%</div>
      </div>
      <div class="rt">
        <div class="val">${r.value != null ? eur(r.value) : '—'}</div>
        <div class="sub"><span class="dim">HOY</span> <span class="${cls(r.day)}">${dayTxt}</span></div>
        <div class="sub"><span class="dim">P/L</span> <span class="${cls(r.pl)}">${plTxt}</span></div>
      </div>
    </div>`;
  }

  // Gráfico de línea nítido (SVG), sin degradados.
  const W = 600, H = 190, PAD = 10;
  function chartSvg(pts, chg) {
    if (!pts || pts.length < 2) return `<div class="empty">${M.busy() ? 'CARGANDO HISTÓRICO…' : 'SIN DATOS PARA ESTE RANGO'}</div>`;
    const vs = pts.map(p => p.v);
    let lo = Math.min(...vs), hi = Math.max(...vs);
    if (hi - lo < 1) { hi += 1; lo -= 1; }
    const x = i => (i / (pts.length - 1)) * W;
    const y = v => PAD + (1 - (v - lo) / (hi - lo)) * (H - 2 * PAD);
    const col = chg >= 0 ? 'var(--green)' : 'var(--red)';
    const d = pts.map((p, i) => (i ? 'L' : 'M') + x(i).toFixed(1) + ' ' + y(p.v).toFixed(1)).join('');
    return `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">
      <line x1="0" x2="${W}" y1="${y(pts[0].v)}" y2="${y(pts[0].v)}" stroke="#3a3a3a" stroke-dasharray="3 4" vector-effect="non-scaling-stroke"/>
      <path d="${d}" fill="none" stroke="${col}" stroke-width="1.6" stroke-linejoin="miter" vector-effect="non-scaling-stroke"/>
      <line id="cx" x1="0" x2="0" y1="0" y2="${H}" stroke="#e8e8e8" stroke-width="1" vector-effect="non-scaling-stroke" visibility="hidden"/>
      <rect id="cd" width="7" height="7" fill="${col}" visibility="hidden"/>
    </svg>`;
  }
  function bindScrub(pts, total, day, dayPct) {
    const el = $('#chart');
    if (!el || pts.length < 2) return;
    const svg = el.querySelector('svg');
    const vs = pts.map(p => p.v);
    let lo = Math.min(...vs), hi = Math.max(...vs);
    if (hi - lo < 1) { hi += 1; lo -= 1; }
    const move = ev => {
      const r = el.getBoundingClientRect();
      const cx = (ev.touches ? ev.touches[0].clientX : ev.clientX) - r.left;
      const i = Math.max(0, Math.min(pts.length - 1, Math.round(cx / r.width * (pts.length - 1))));
      const p = pts[i], X = i / (pts.length - 1) * W, Y = PAD + (1 - (p.v - lo) / (hi - lo)) * (H - 2 * PAD);
      svg.querySelector('#cx').setAttribute('x1', X); svg.querySelector('#cx').setAttribute('x2', X);
      svg.querySelector('#cx').setAttribute('visibility', 'visible');
      const dot = svg.querySelector('#cd'); dot.setAttribute('x', X - 3.5); dot.setAttribute('y', Y - 3.5); dot.setAttribute('visibility', 'visible');
      const { chg, pct } = rangeStats(pts, i);
      $('#hLabel').textContent = /^\d/.test(p.d) ? fdate(p.d) : p.d;
      $('#hBig').textContent = eur(p.v);
      $('#hChg').innerHTML = `<span class="${cls(chg)}">${sEur(chg)} (${sPct(pct)})</span> <span class="muted">DESDE ${/^\d/.test(pts[0].d) ? fdate(pts[0].d) : pts[0].d}</span>`;
    };
    const end = () => {
      svg.querySelector('#cx').setAttribute('visibility', 'hidden');
      svg.querySelector('#cd').setAttribute('visibility', 'hidden');
      $('#hLabel').textContent = 'PATRIMONIO';
      $('#hBig').textContent = eur(total);
      $('#hChg').innerHTML = `<span class="${cls(day)}">${sEur(day)} (${sPct(dayPct)})</span> <span class="muted">HOY</span>`;
    };
    el.addEventListener('touchstart', move, { passive: true });
    el.addEventListener('touchmove', move, { passive: true });
    el.addEventListener('touchend', end);
    el.addEventListener('mousemove', move);
    el.addEventListener('mouseleave', end);
  }

  // ---------- Ficha (screens.js) ----------
  function openAsset(id) { window.Screens.ficha(id); }

  // ---------- "+" ----------
  function openAdd() { window.Forms.openAdd(); }

  // ---------- Pestañas pendientes ----------
  function renderSoon(title, what) {
    shell(`<div class="soon"><b>${title}</b>${what}</div>`);
  }
  function renderAjustes() {
    const n = { a: S.list('asset').length, t: S.list('tx').length, d: S.list('dividend').length };
    shell(`<h2><span>AJUSTES</span></h2>
      <div class="kv" style="margin-top:12px">
        <div class="k">SINCRONIZACIÓN</div><div class="v">${syncDot()}</div>
        <div class="k">ÚLTIMA SUBIDA</div><div class="v">${S.lastSync() ? madrid(S.lastSync()) : '—'}</div>
        <div class="k">ACTIVOS / OPERACIONES / DIVIDENDOS</div><div class="v">${n.a} / ${n.t} / ${n.d}</div>
        <div class="k">TIPOS BCE</div><div class="v">${M.fxDate() ? fdate(M.fxDate()) : '—'}</div>
      </div>
      <div class="soon"><b>BROKERS · RETENCIONES · REGLAS · COPIA</b>EN LA FASE DE AJUSTES</div>
      <button class="block" id="logout">CERRAR SESIÓN EN ESTE MÓVIL</button>`);
    $('#logout').onclick = () => { if (S.pending()) { toast('Hay cambios sin subir: conéctate primero'); return; } S.logout(); render(); };
  }

  // ---------- Acceso ----------
  async function renderLogin() {
    app.innerHTML = `<main class="login"><h1><span class="up">&gt;</span> CARTERA CARLOS_</h1><div class="note">Conectando…</div></main>`;
    let st = null;
    try { st = await S.serverStatus(); } catch (e) { /* sin red */ }
    const create = st === 'new';
    app.innerHTML = `<main class="login">
      <h1><span class="up">&gt;</span> CARTERA CARLOS_</h1>
      <div class="label">${create ? 'CREA TU CÓDIGO DE ACCESO' : 'CÓDIGO DE ACCESO'}</div>
      <input id="code" type="password" autocomplete="current-password" placeholder="${create ? 'mínimo 6 caracteres' : 'tu código'}">
      <div class="err" id="err">${st == null ? 'Sin conexión con la nube. Revisa la red.' : ''}</div>
      <button class="primary block" id="go">${create ? 'CREAR Y CARGAR MIS DATOS' : 'ENTRAR'}</button>
      <p class="note">${create ? 'Es la primera vez: el código protegerá tu cartera en la nube. Apúntalo; lo pedirá cada móvil nuevo.' : 'El mismo código en todos tus móviles.'}</p>
    </main>`;
    const go = async () => {
      const code = $('#code').value.trim();
      $('#go').disabled = true; $('#err').textContent = '';
      try {
        const r = await S.login(code, create);
        if (r === 'created' || r === 'ok') { await seedIfEmpty(); render(); refreshMarket(false); return; }
        if (r === 'not_configured') { renderLogin(); return; } // la nube aún no tiene código: pasar a "crear"
        $('#err').textContent = r === 'too_short' ? 'Mínimo 6 caracteres.' : 'Código incorrecto.';
      } catch (e) {
        $('#err').textContent = /too_many/.test(e.message) ? 'Demasiados intentos. Espera 10 minutos.' : 'Sin conexión. Inténtalo de nuevo.';
      }
      $('#go').disabled = false;
    };
    $('#go').onclick = go;
    $('#code').onkeydown = e => { if (e.key === 'Enter') go(); };
  }
  // Carga inicial desde la hoja (solo si la nube está vacía y existe seed.json junto a la app).
  async function seedIfEmpty() {
    if (S.list('asset').length) return;
    try {
      const res = await fetch('seed.json', { cache: 'no-store' });
      if (!res.ok) return;
      const items = await res.json();
      await S.putMany(items);
      toast('Datos de la hoja cargados: ' + items.length);
    } catch (e) { console.warn('seed', e); }
  }

  // ---------- Mercado ----------
  function refreshMarket(force) {
    const mdl = model();
    const held = mdl.rows.map(r => r.a);
    const withTx = [...new Set(mdl.txs.map(t => t.asset))].map(id => mdl.byId[id]).filter(Boolean);
    const first = mdl.txs.reduce((m, t) => t.date < m ? t.date : m, today());
    if (!held.length) return Promise.resolve();
    // Fichas (fechas de dividendo y resultados) de tus acciones: cada 6 h.
    let info = [];
    if (Date.now() - pref('infoAt', 0) > 6 * 3600 * 1000) {
      info = held.filter(a => a.type !== 'crypto' && a.yahoo).map(a => a.yahoo);
      setPref('infoAt', Date.now());
    }
    return M.refresh({ assets: held, histAssets: withTx, from: first, force, info });
  }

  // ---------- Tirar para refrescar ----------
  (function pullToRefresh() {
    let y0 = null, dy = 0;
    window.addEventListener('touchstart', e => { y0 = window.scrollY <= 0 && !document.querySelector('.sheet-bg') ? e.touches[0].clientY : null; dy = 0; }, { passive: true });
    window.addEventListener('touchmove', e => {
      if (y0 == null) return;
      dy = e.touches[0].clientY - y0;
      const p = $('#ptr'); if (!p) return;
      const h = Math.max(0, Math.min(56, dy / 2.2));
      p.style.height = h + 'px'; p.style.lineHeight = h + 'px';
      p.textContent = dy > 120 ? '↻ SUELTA PARA ACTUALIZAR' : '↓ TIRA PARA ACTUALIZAR';
    }, { passive: true });
    window.addEventListener('touchend', () => {
      const p = $('#ptr');
      if (y0 != null && dy > 120 && S.loggedIn()) { S.syncNow(); refreshMarket(true); toast('Actualizando precios…'); }
      if (p) { p.style.height = '0'; }
      y0 = null; dy = 0;
    });
  })();

  // Logos que fallan -> iniciales
  document.addEventListener('error', e => {
    const img = e.target;
    if (img.tagName !== 'IMG' || !img.dataset.fb) return;
    const box = img.parentNode;
    box.className = 'logo txt'; box.textContent = img.dataset.fb;
  }, true);

  // ---------- Render ----------
  function render() {
    if (!S.loggedIn()) { renderLogin(); return; }
    if (S.status() === 'bad_secret') { S.logout(); renderLogin(); return; }
    const y = window.scrollY;
    if (ui.tab === 'cartera') renderCartera();
    else if (ui.tab === 'dividendos') window.Screens.dividendos();
    else if (ui.tab === 'calendario') window.Screens.calendario();
    else if (ui.tab === 'analisis') window.Analysis.render();
    else renderAjustes();
    window.scrollTo(0, y);
  }

  let pending = null, seenVersion = S.version();
  const later = () => { if (document.querySelector('.sheet-bg')) return; clearTimeout(pending); pending = setTimeout(render, 80); };
  S.onChange(() => {
    const b = $('#syncBtn'); if (b) b.innerHTML = syncDot();
    if (!S.loggedIn()) return;
    if (S.status() === 'bad_secret') { render(); return; }
    if (S.version() !== seenVersion) {
      const firstData = !cache.rows || !cache.rows.length;
      seenVersion = S.version(); later();
      if (firstData) setTimeout(() => refreshMarket(false), 100);
    }
  });
  let pendTimer = null;
  const checkPending = () => {
    clearTimeout(pendTimer);
    pendTimer = setTimeout(() => {
      if (!S.loggedIn() || !S.lastSync() || M.busy() || S.pending()) return;
      try { const n = window.Divs.ensurePending(); if (n) toast(n === 1 ? '1 DIVIDENDO PENDIENTE DE CONFIRMAR' : n + ' DIVIDENDOS PENDIENTES DE CONFIRMAR'); } catch (e) { console.warn(e); }
    }, 1500);
  };
  M.onChange(() => { later(); checkPending(); });
  document.addEventListener('visibilitychange', () => { if (!document.hidden && S.loggedIn()) refreshMarket(false); });

  window.UI = { shell, fnum, eur, sEur, sPct, cls, price, qtyFmt, fdate, today, esc, initials, toast, sheet, model, logoHtml, render, openAsset, refreshMarket };
  render();
  if (S.loggedIn()) refreshMarket(false);
  setTimeout(checkPending, 2500);
  S.onChange(() => { if (S.status() === 'ok') checkPending(); });
})();
