// Pantallas DIVIDENDOS, CALENDARIO y FICHA de activo (con gráficas).
(function () {
  'use strict';
  const S = window.Store, M = window.Market, C = window.Calc, D = window.Divs;
  const U = () => window.UI;
  const $ = (sel, el) => (el || document).querySelector(sel);
  const MES = ['ENE', 'FEB', 'MAR', 'ABR', 'MAY', 'JUN', 'JUL', 'AGO', 'SEP', 'OCT', 'NOV', 'DIC'];
  const MES_L = ['ENERO', 'FEBRERO', 'MARZO', 'ABRIL', 'MAYO', 'JUNIO', 'JULIO', 'AGOSTO', 'SEPTIEMBRE', 'OCTUBRE', 'NOVIEMBRE', 'DICIEMBRE'];
  const DOW = ['DOM', 'LUN', 'MAR', 'MIÉ', 'JUE', 'VIE', 'SÁB'];
  const st = { year: null, calFilter: 'all', calWatch: false, fichaRange: '1A' };
  const dd = iso => iso.slice(8, 10) + '/' + iso.slice(5, 7);
  const dow = iso => DOW[new Date(iso + 'T12:00:00Z').getUTCDay()];
  const heldRows = () => U().model().rows.filter(r => r.a.type !== 'crypto');
  const statusTag = s => s === 'estimated' ? '<span class="tag dim">ESTIMADO</span>' : '<span class="tag cyan">CONFIRMADO</span>';

  // ---------- Gráficas SVG nítidas ----------
  // Barras: [{ label, a (relleno), b (contorno), note }]
  function barsSvg(data, opts) {
    opts = opts || {};
    const W = 600, H = opts.h || 170, top = 16, bottom = 22;
    const max = Math.max(1e-9, ...data.map(d => Math.max(d.a || 0, (d.a || 0) + (d.b || 0))));
    const bw = W / data.length;
    const y = v => top + (1 - v / max) * (H - top - bottom);
    let g = '';
    data.forEach((d, i) => {
      const x = i * bw + bw * 0.18, w = bw * 0.64;
      if (d.a > 0) g += `<rect x="${x}" y="${y(d.a)}" width="${w}" height="${H - bottom - y(d.a)}" fill="${opts.color || 'var(--yellow)'}"/>`;
      if (d.b > 0) {
        const y0 = y((d.a || 0) + d.b), h = y(d.a || 0) - y0;
        g += `<rect x="${x + 0.75}" y="${y0 + 0.75}" width="${w - 1.5}" height="${Math.max(0, h - 1.5)}" fill="none" stroke="${opts.color || 'var(--yellow)'}" stroke-width="1.5" stroke-dasharray="4 3"/>`;
      }
      g += `<text x="${i * bw + bw / 2}" y="${H - 6}" text-anchor="middle" font-size="${opts.fs || 15}" fill="${d.hl ? 'var(--fg)' : '#7c7c7c'}" font-family="JetBrains Mono, monospace">${d.label}</text>`;
      if (d.note) g += `<text x="${i * bw + bw / 2}" y="${Math.max(12, y((d.a || 0) + (d.b || 0)) - 4)}" text-anchor="middle" font-size="${opts.fs ? opts.fs - 2 : 13}" fill="#e8e8e8" font-family="JetBrains Mono, monospace">${d.note}</text>`;
    });
    return `<svg viewBox="0 0 ${W} ${H}" class="bars">${g}<line x1="0" x2="${W}" y1="${H - bottom}" y2="${H - bottom}" stroke="#3a3a3a"/></svg>`;
  }

  // Línea con dedo (precio de una acción). pts: [{d, v}], marks: [{d, type}], ref: precio medio.
  function lineChart(box, pts, opts) {
    opts = opts || {};
    if (!pts || pts.length < 2) { box.innerHTML = `<div class="empty">${opts.loading ? 'CARGANDO GRÁFICO…' : 'SIN DATOS'}</div>`; return; }
    const W = 600, H = 200, PAD = 12;
    const vs = pts.map(p => p.v).concat(opts.ref ? [opts.ref] : []);
    let lo = Math.min(...vs), hi = Math.max(...vs);
    if (hi - lo < hi * 0.002) { hi *= 1.01; lo *= 0.99; }
    const x = i => i / (pts.length - 1) * W;
    const y = v => PAD + (1 - (v - lo) / (hi - lo)) * (H - 2 * PAD);
    const up = pts[pts.length - 1].v >= pts[0].v;
    const col = up ? 'var(--green)' : 'var(--red)';
    const d = pts.map((p, i) => (i ? 'L' : 'M') + x(i).toFixed(1) + ' ' + y(p.v).toFixed(1)).join('');
    let marks = '';
    if (opts.marks) {
      const idx = {}; pts.forEach((p, i) => { idx[p.d] = i; });
      opts.marks.forEach(m => {
        let i = idx[m.d];
        if (i == null) { i = pts.findIndex(p => p.d >= m.d); if (i < 0) return; }
        const c = m.type === 'sell' ? 'var(--red)' : m.type === 'buy' ? 'var(--green)' : 'var(--cyan)';
        marks += `<rect x="${x(i) - 4}" y="${H - 9}" width="8" height="8" fill="${c}"/>`;
      });
    }
    box.innerHTML = `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">
      ${opts.ref ? `<line x1="0" x2="${W}" y1="${y(opts.ref)}" y2="${y(opts.ref)}" stroke="var(--yellow)" stroke-dasharray="5 4" vector-effect="non-scaling-stroke"/>` : ''}
      <path d="${d}" fill="none" stroke="${col}" stroke-width="1.6" vector-effect="non-scaling-stroke"/>
      ${marks}
      <line class="cx" x1="0" x2="0" y1="0" y2="${H}" stroke="#e8e8e8" vector-effect="non-scaling-stroke" visibility="hidden"/>
      <rect class="cd" width="7" height="7" fill="${col}" visibility="hidden"/></svg>`;
    const svg = box.querySelector('svg');
    const move = ev => {
      const r = box.getBoundingClientRect();
      const cx = (ev.touches ? ev.touches[0].clientX : ev.clientX) - r.left;
      const i = Math.max(0, Math.min(pts.length - 1, Math.round(cx / r.width * (pts.length - 1))));
      const X = x(i), Y = y(pts[i].v);
      const l = svg.querySelector('.cx'); l.setAttribute('x1', X); l.setAttribute('x2', X); l.setAttribute('visibility', 'visible');
      const c = svg.querySelector('.cd'); c.setAttribute('x', X - 3.5); c.setAttribute('y', Y - 3.5); c.setAttribute('visibility', 'visible');
      opts.onScrub && opts.onScrub(pts[i], i);
    };
    const end = () => { svg.querySelector('.cx').setAttribute('visibility', 'hidden'); svg.querySelector('.cd').setAttribute('visibility', 'hidden'); opts.onScrub && opts.onScrub(null); };
    box.addEventListener('touchstart', move, { passive: true });
    box.addEventListener('touchmove', move, { passive: true });
    box.addEventListener('touchend', end);
    box.addEventListener('mousemove', move);
    box.addEventListener('mouseleave', end);
  }

  // ======================================================================
  // DIVIDENDOS
  // ======================================================================
  function renderDividendos() {
    const UI = U(), t = UI.today();
    const rows = heldRows();
    const f = D.forecast(rows);
    const divs = S.list('dividend');
    const pending = divs.filter(d => d.status === 'pending').sort((x, y) => x.date < y.date ? -1 : 1);
    const paid = divs.filter(d => d.status !== 'pending');
    const years = [...new Set(paid.map(d => +d.date.slice(0, 4)))].sort();
    const cy = +t.slice(0, 4);
    if (!st.year) st.year = cy;
    const year = st.year;

    // Próximos pagos (tus posiciones)
    const up = D.upcoming(rows.map(r => r.a), { back: 0 }).filter(e => e.pay > t && e.qty > 0);
    // Barras del año: cobrado vs previsto
    const cob = Array(12).fill(0), prev = Array(12).fill(0);
    paid.filter(d => +d.date.slice(0, 4) === year).forEach(d => { cob[+d.date.slice(5, 7) - 1] += d.net || 0; });
    if (year === cy) {
      up.filter(e => +e.pay.slice(0, 4) === year).forEach(e => { prev[+e.pay.slice(5, 7) - 1] += e.net; });
      pending.filter(d => +d.date.slice(0, 4) === year).forEach(d => { prev[+d.date.slice(5, 7) - 1] += d.net || 0; });
    }
    const totCob = cob.reduce((s, v) => s + v, 0), totPrev = prev.reduce((s, v) => s + v, 0);
    const bars = barsSvg(MES.map((m, i) => ({ label: m[0], a: cob[i], b: prev[i], hl: year === cy && i === +t.slice(5, 7) - 1 })));
    // Histórico por años
    const perYear = years.map(y => ({ y, v: paid.filter(d => +d.date.slice(0, 4) === y).reduce((s, d) => s + (d.net || 0), 0) }));
    const maxY = Math.max(1, ...perYear.map(p => p.v));

    U().shell(`
      <section class="hero">
        <div class="label">RENTA ANUAL PREVISTA · NETA</div>
        <div class="big yellow">${UI.eur(f.net)}</div>
        <div class="chg"><span class="muted">BRUTA</span> ${UI.eur(f.gross)} <span class="muted">· MES</span> ${UI.eur(f.monthly)}</div>
        <div class="chg"><span class="muted">YIELD</span> <span class="cyan">${UI.fnum(f.yld * 100, 2)}%</span> <span class="muted">· YoC</span> <span class="cyan">${UI.fnum(f.yoc * 100, 2)}%</span></div>
      </section>

      ${pending.length ? `<h2><span class="yellow">PENDIENTES DE CONFIRMAR · ${pending.length}</span></h2>
      <div class="rows">${pending.map(d => {
        const a = S.get(d.asset) || { ticker: '?', name: '' };
        return `<div class="row pend" data-pid="${UI.esc(d.id)}">${UI.logoHtml(a, M.quote(a))}
          <div class="mid"><div class="tk">${UI.esc(a.ticker)}</div><div class="nm">PAGO ${UI.fdate(d.date)}${d.qty ? ' · ' + UI.qtyFmt(d.qty) + ' acc.' : ''}</div></div>
          <div class="rt"><div class="val yellow">${UI.eur(d.net)}</div>
          <div class="pbtns"><button data-fix="${UI.esc(d.id)}">CORREGIR</button><button data-ok="${UI.esc(d.id)}" class="okb">✓ OK</button></div></div></div>`;
      }).join('')}</div>` : ''}

      <h2><span>${year === cy ? 'ESTE AÑO' : 'AÑO'}</span>
        <span class="ysel"><button id="yPrev" ${years[0] >= year ? 'disabled' : ''}>‹</button> ${year} <button id="yNext" ${year >= cy ? 'disabled' : ''}>›</button></span></h2>
      <div class="kv" style="margin:10px 0 2px">
        <div class="k">COBRADO</div><div class="v yellow">${UI.eur(totCob)}</div>
        ${year === cy ? `<div class="k">PREVISTO RESTO DEL AÑO</div><div class="v">${UI.eur(totPrev)}</div>
        <div class="k">TOTAL ${year}</div><div class="v"><b>${UI.eur(totCob + totPrev)}</b></div>` : ''}
      </div>
      <div class="chartbox">${bars}</div>
      <div class="legend"><span><i class="sw fill"></i>COBRADO</span><span><i class="sw dash"></i>PREVISTO</span></div>

      <h2><span>HISTÓRICO POR AÑOS</span></h2>
      <div class="yrs">${perYear.map((p, i) => {
        // año en curso: se compara con el mismo periodo del año anterior
        const base = i ? (p.y === cy ? paid.filter(d => +d.date.slice(0, 4) === p.y - 1 && d.date.slice(5) <= t.slice(5)).reduce((s2, d) => s2 + (d.net || 0), 0) : perYear[i - 1].v) : 0;
        const g = i && base > 0 ? p.v / base - 1 : null;
        return `<div class="yr"><span class="y">${p.y}${p.y === cy ? '*' : ''}</span><span class="bar"><i style="width:${(p.v / maxY * 100).toFixed(1)}%"></i></span>
          <span class="v">${UI.eur(p.v, 0)}</span><span class="g ${g == null ? 'dim' : UI.cls(g)}">${g == null ? '—' : UI.sPct(g)}</span></div>`;
      }).join('')}</div>

      <div class="muted" style="font-size:10.5px;margin-top:6px">* ${cy} hasta hoy, comparado con el mismo periodo de ${cy - 1}.</div>

      <h2><span>PRÓXIMOS PAGOS</span><span class="muted">NETO ESTIMADO</span></h2>
      <div class="rows">${up.slice(0, 25).map(e => `<div class="row" data-id="${UI.esc(e.asset.id)}">${UI.logoHtml(e.asset, M.quote(e.asset))}
        <div class="mid"><div class="tk">${UI.esc(e.asset.ticker)} ${statusTag(e.status)}</div>
          <div class="nm">EX ${e.ex ? UI.fdate(e.ex) : '—'} · PAGO ${UI.fdate(e.pay)}</div>
          <div class="nm">${UI.qtyFmt(e.qty)} × ${UI.price(e.perShare, e.currency)}</div></div>
        <div class="rt"><div class="val yellow">${UI.eur(e.net)}</div><div class="sub dim">${dd(e.pay)}</div></div></div>`).join('') || '<div class="soon">SIN PAGOS PREVISTOS</div>'}</div>

      <h2><span>RENTA POR EMPRESA</span><span class="muted">NETA/AÑO</span></h2>
      <div class="rows">${f.by.map(b => `<div class="row" data-id="${UI.esc(b.a.id)}">${UI.logoHtml(b.a, M.quote(b.a))}
        <div class="mid"><div class="tk">${UI.esc(b.a.ticker)}</div><div class="nm">YIELD ${UI.fnum(b.yld * 100, 2)}% · YoC ${UI.fnum(b.yoc * 100, 2)}%</div>
          <div class="wbar"><i style="width:${(f.net ? b.net / f.net * 100 : 0).toFixed(1)}%"></i></div></div>
        <div class="rt"><div class="val">${UI.eur(b.net)}</div><div class="sub dim">${UI.fnum(f.net ? b.net / f.net * 100 : 0, 1)}%</div></div></div>`).join('')}</div>`);

    const app = document.getElementById('app');
    const y0 = $('#yPrev'), y1 = $('#yNext');
    if (y0) y0.onclick = () => { st.year--; U().render(); };
    if (y1) y1.onclick = () => { st.year++; U().render(); };
    app.querySelectorAll('[data-ok]').forEach(b => b.onclick = e => {
      e.stopPropagation();
      const d = S.get(b.dataset.ok); if (!d) return;
      S.put('dividend', Object.assign({}, d, { status: 'confirmed' }));
      U().toast('DIVIDENDO CONFIRMADO · ' + U().eur(d.net));
    });
    app.querySelectorAll('[data-fix]').forEach(b => b.onclick = e => { e.stopPropagation(); window.Forms.openDividend({ div: S.get(b.dataset.fix) }); });
    app.querySelectorAll('.rows [data-id]').forEach(el => el.onclick = () => ficha(el.dataset.id));
  }

  // ======================================================================
  // CALENDARIO
  // ======================================================================
  let watchInfoAt = 0;
  function renderCalendario() {
    const UI = U(), t = UI.today();
    const mdl = UI.model();
    const held = mdl.rows.filter(r => r.a.type !== 'crypto').map(r => r.a);
    const heldIds = new Set(held.map(a => a.id));
    let assets = held.slice();
    if (st.calWatch) {
      const watch = mdl.assets.filter(a => a.type !== 'crypto' && !heldIds.has(a.id) && a.yahoo);
      assets = assets.concat(watch);
      if (Date.now() - watchInfoAt > 6 * 3600 * 1000) {
        watchInfoAt = Date.now();
        const chunks = []; for (let i = 0; i < watch.length; i += 50) chunks.push(watch.slice(i, i + 50));
        chunks.reduce((p, c) => p.then(() => M.load(c, { info: true })), Promise.resolve()).catch(() => { watchInfoAt = 0; });
      }
    }
    const ev = [];
    const from = C.addDays(t, -7);
    assets.forEach(a => {
      const mine = heldIds.has(a.id);
      if (st.calFilter !== 'earn') D.eventsFor(a, { back: 7 }).forEach(e => {
        if (!mine && e.status === 'estimated') return;
        if (e.ex && e.ex >= from) ev.push({ d: e.ex, kind: 'ex', a, e, mine });
        if (e.pay >= from) ev.push({ d: e.pay, kind: 'pay', a, e, mine });
      });
      if (st.calFilter !== 'div') {
        const inf = a.yahoo && M.info(a.yahoo);
        (inf && inf.earnings || []).forEach(d => { if (d >= from) ev.push({ d, kind: 'earn', a, mine, est: inf.earningsEstimate }); });
      }
    });
    ev.sort((x, y) => x.d < y.d ? -1 : x.d > y.d ? 1 : x.kind.localeCompare(y.kind));
    let html = '', lastM = '';
    ev.forEach(x => {
      const m = x.d.slice(0, 7);
      if (m !== lastM) { html += `<h2><span>${MES_L[+m.slice(5) - 1]} ${m.slice(0, 4)}</span></h2>`; lastM = m; }
      const tag = x.kind === 'ex' ? '<span class="evt cyan">EX-DIV</span>' : x.kind === 'pay' ? '<span class="evt yellow">PAGO</span>' : '<span class="evt purple">RESULTADOS</span>';
      const detail = x.kind === 'earn' ? (x.est ? 'Fecha estimada' : 'Presentación de resultados')
        : x.kind === 'ex' ? `Compra antes para cobrar ${UI.price(x.e.perShare, x.e.currency)}/acc.` : (x.mine && x.e.qty > 0 ? `Cobras ~${UI.eur(x.e.net)} neto` : `${UI.price(x.e.perShare, x.e.currency)}/acc.`);
      html += `<div class="row cal ${x.d < t ? 'past' : ''}" data-id="${UI.esc(x.a.id)}">
        <div class="day"><b>${x.d.slice(8, 10)}</b><span>${dow(x.d)}</span></div>
        ${UI.logoHtml(x.a, M.quote(x.a))}
        <div class="mid"><div class="tk">${UI.esc(x.a.ticker)} ${tag}${x.kind !== 'earn' && x.e.status === 'estimated' ? '<span class="tag dim">EST.</span>' : ''}${!x.mine ? '<span class="tag dim">SEGUIM.</span>' : ''}</div>
          <div class="nm ellipsis">${detail}</div></div></div>`;
    });
    UI.shell(`
      <div class="seg">${[['all', 'TODO'], ['div', 'DIVIDENDOS'], ['earn', 'RESULTADOS']].map(o => `<button data-cf="${o[0]}" class="${st.calFilter === o[0] ? 'on' : ''}">${o[1]}</button>`).join('')}</div>
      <div class="chips" style="margin-top:10px"><button id="cw" class="${st.calWatch ? 'on' : ''}">${st.calWatch ? '✓ ' : ''}INCLUIR SEGUIMIENTO</button></div>
      ${html || `<div class="soon"><b>SIN EVENTOS</b>${M.busy() ? 'CARGANDO FECHAS…' : 'Las fechas llegan de Yahoo al abrir la app.'}</div>`}`);
    const app = document.getElementById('app');
    app.querySelectorAll('[data-cf]').forEach(b => b.onclick = () => { st.calFilter = b.dataset.cf; UI.render(); });
    $('#cw').onclick = () => { st.calWatch = !st.calWatch; UI.render(); };
    app.querySelectorAll('.row[data-id]').forEach(el => el.onclick = () => ficha(el.dataset.id));
  }

  // ======================================================================
  // FICHA DE ACTIVO
  // ======================================================================
  const RANGES = [['1M', 30], ['6M', 182], ['YTD', 0], ['1A', 365], ['5A', 1826], ['MAX', 99999]];
  const bigNum = n => {
    if (n == null) return '—';
    const UI = U();
    if (n >= 1e12) return UI.fnum(n / 1e12, 2) + ' B';
    if (n >= 1e9) return UI.fnum(n / 1e9, 1) + ' mil M';
    if (n >= 1e6) return UI.fnum(n / 1e6, 1) + ' M';
    return UI.fnum(n, 0);
  };
  const freqLabel = n => n >= 11 ? 'MENSUAL' : n >= 4 ? 'TRIMESTRAL' : n >= 2 ? 'SEMESTRAL' : n === 1 ? 'ANUAL' : '—';

  function pricePoints(a, range) {
    const t = U().today();
    const r = RANGES.find(x => x[0] === range);
    const from = range === 'YTD' ? t.slice(0, 4) + '-01-01' : C.addDays(t, -r[1]);
    const q = M.quote(a);
    let src = null;
    const h = M.history(a);
    const dDays = Object.keys(h.closes).sort();
    if ((r[1] <= 366 || range === 'YTD') && dDays.length && dDays[0] <= C.addDays(from, 7)) src = h.closes;
    if (!src) { const lh = M.longHistory(a); if (lh) src = lh.closes; else if (dDays.length) src = h.closes; }
    if (!src) return [];
    const pts = Object.keys(src).sort().filter(d => d >= from).map(d => ({ d, v: src[d] }));
    if (q && pts.length && pts[pts.length - 1].d < t) pts.push({ d: t, v: q.price });
    return pts;
  }

  function ficha(id) {
    const a0 = S.get(id);
    if (!a0) return;
    const bg = U().sheet('<div id="fz"></div>');
    bg.classList.add('full');
    const draw = () => { if (bg.isConnected) drawFicha(bg, S.get(id) || a0); };
    draw();
    const a = a0;
    const need = a.type !== 'crypto' && a.yahoo && (!M.info(a.yahoo) || !M.longHistory(a));
    if (need || !Object.keys(M.history(a).closes).length || !M.quote(a)) {
      M.load([a], { info: a.type !== 'crypto', history: true, from: C.addDays(U().today(), -400), long: a.type !== 'crypto' })
        .then(draw).catch(draw);
    }
  }

  function drawFicha(bg, a) {
    const UI = U(), t = UI.today();
    const mdl = UI.model();
    const p = mdl.pos[a.id], r = mdl.rows.find(x => x.a.id === a.id);
    const q = (r && r.q) || M.quote(a);
    const held = p && p.qty > 0;
    const total = mdl.rows.reduce((s, x) => s + (x.value || 0), 0);
    const inf = (a.yahoo && M.info(a.yahoo)) || {};
    const isC = a.type === 'crypto';
    const cur = q ? q.currency : a.currency;
    const dayCh = q && q.prev ? (q.price - q.prev) / q.prev : null;
    // Dividendos
    const ann = isC ? 0 : D.annualPerShare(a);
    const yld = q && ann ? ann / q.price : null;
    const yoc = held && ann && p.avgLocal ? ann / p.avgLocal : null;
    const psh = isC ? [] : D.perShareHistory(a);
    const freq = isC ? 0 : D.frequency(a);
    const evs = isC ? [] : D.eventsFor(a, { back: 0 }).filter(e => e.pay > t);
    const next = evs[0];
    const byYear = {};
    psh.forEach(x => { const y = +x.d.slice(0, 4); byYear[y] = (byYear[y] || 0) + x.amount; });
    const cy = +t.slice(0, 4);
    const yrs = Object.keys(byYear).map(Number).filter(y => y < cy + 1).sort().slice(-11);
    const full = yrs.filter(y => y < cy);
    const cagr = full.length >= 6 && byYear[full[full.length - 6]] > 0 ? Math.pow(byYear[full[full.length - 1]] / byYear[full[full.length - 6]], 1 / 5) - 1 : null;
    const myDivs = S.list('dividend').filter(d => d.asset === a.id).sort((x, y) => x.date < y.date ? 1 : -1);
    const myDivSum = myDivs.filter(d => d.status !== 'pending').reduce((s, d) => s + (d.net || 0), 0);
    const txs = (p ? p.txs : []).slice().reverse();
    const brokers = [...new Set((p ? p.txs : []).map(x => (S.get(x.broker) || {}).name).filter(Boolean))];
    const TYPE = { buy: 'COMPRA', sell: 'VENTA', scrip: 'SCRIP', earn: 'RECOMPENSA' };
    const DTYPE = { dividend: 'DIVIDENDO', scrip: 'SCRIP', substitute: 'SUSTITUCIÓN' };
    const loading = M.busy() || (!isC && a.yahoo && !M.longHistory(a));

    $('#fz', bg).innerHTML = `
      <div class="hd"><div style="display:flex;align-items:center;gap:11px">${UI.logoHtml(a, q)}<div><div class="t">${UI.esc(a.ticker)}</div><div class="nm muted">${UI.esc(a.name)}</div></div></div><button data-close>✕</button></div>
      <div class="fprice"><span class="big" id="fpv">${q ? UI.price(q.price, cur) : '—'}</span>
        <span id="fpc" class="${UI.cls(dayCh)}">${dayCh != null ? UI.sPct(dayCh) + ' HOY' : ''}</span></div>
      <div class="chart" id="fch"></div>
      <div class="ranges">${RANGES.map(x => `<button data-fr="${x[0]}" class="${st.fichaRange === x[0] ? 'on' : ''}">${x[0]}</button>`).join('')}</div>
      <div class="legend">${held ? '<span><i class="sw ref"></i>TU PRECIO MEDIO</span>' : ''}<span><i class="sw sq g"></i>COMPRA</span><span><i class="sw sq r"></i>VENTA</span></div>

      <div class="acts">
        <button data-act="buy" class="up">+ COMPRA</button>
        ${held ? '<button data-act="sell" class="down">− VENTA</button>' : ''}
        ${isC ? '' : '<button data-act="div" class="yellow">$ DIV</button>'}
        ${held && !isC ? '<button data-act="scrip" class="cyan">⟳ SCRIP</button>' : ''}
        <button data-act="edit" class="purple">✎ EDIT</button>
      </div>

      ${isC ? '' : `<h2><span>DATOS CLAVE</span></h2>
      <div class="grid-kv">
        <div><span>PER</span><b>${inf.pe != null ? UI.fnum(inf.pe, 1) : '—'}</b></div>
        <div><span>BPA</span><b>${inf.eps != null ? UI.price(inf.eps, cur) : '—'}</b></div>
        <div><span>CAPITALIZ.</span><b>${bigNum(inf.marketCap)}</b></div>
        <div><span>RPD</span><b class="yellow">${yld ? UI.fnum(yld * 100, 2) + '%' : '—'}</b></div>
        <div><span>MÁX 52S</span><b>${q && q.high52 ? UI.price(q.high52, cur) : inf.high52 ? UI.price(inf.high52, cur) : '—'}</b></div>
        <div><span>MÍN 52S</span><b>${q && q.low52 ? UI.price(q.low52, cur) : inf.low52 ? UI.price(inf.low52, cur) : '—'}</b></div>
      </div>

      <h2><span class="yellow">DIVIDENDOS</span><span class="muted">POR ACCIÓN</span></h2>
      <div class="grid-kv">
        <div><span>DIV. ANUAL</span><b class="yellow">${ann ? UI.price(ann, cur) : '—'}</b></div>
        <div><span>FRECUENCIA</span><b>${freqLabel(freq)}</b></div>
        <div><span>RPD</span><b>${yld ? UI.fnum(yld * 100, 2) + '%' : '—'}</b></div>
        <div><span>TU YoC</span><b class="cyan">${yoc ? UI.fnum(yoc * 100, 2) + '%' : '—'}</b></div>
        <div><span>CRECIM. 5 AÑOS</span><b class="${UI.cls(cagr)}">${cagr != null ? UI.sPct(cagr) + '/año' : '—'}</b></div>
        <div><span>RETENCIÓN</span><b>${UI.fnum(D.whPct(a) * 100, 0)}% ${UI.esc(a.country || '')}</b></div>
      </div>
      ${next ? `<div class="nextdiv"><div class="label">PRÓXIMO DIVIDENDO ${statusTag(next.status)}</div>
        <div class="nd"><div><span>EX-DIV</span><b>${next.ex ? UI.fdate(next.ex) : '—'}</b></div><div><span>PAGO</span><b>${UI.fdate(next.pay)}</b></div>
        <div><span>POR ACCIÓN</span><b>${UI.price(next.perShare, next.currency)}</b></div>${held ? `<div><span>COBRARÁS ~</span><b class="yellow">${UI.eur(next.net)}</b></div>` : ''}</div></div>` : ''}
      ${yrs.length ? `<div class="label" style="margin-top:14px">DIVIDENDO POR ACCIÓN Y AÑO (${UI.esc(cur || '')})</div>
        <div class="chartbox">${barsSvg(yrs.map(y => ({ label: "'" + String(y).slice(2), a: y < cy ? byYear[y] : 0, b: y === cy ? byYear[y] : 0, note: UI.fnum(byYear[y], byYear[y] < 10 ? 2 : 0) })), { h: 160, fs: 14 })}</div>
        <div class="legend"><span><i class="sw fill"></i>AÑO COMPLETO</span><span><i class="sw dash"></i>${cy} HASTA HOY</span></div>` : (loading ? '<div class="muted" style="margin-top:10px">Cargando historial de dividendos…</div>' : '<div class="muted" style="margin-top:10px">Sin dividendos registrados en Yahoo.</div>')}
      ${psh.length ? `<div class="label" style="margin-top:14px">ÚLTIMOS PAGOS (FECHA EX)</div>
        <div class="paylist">${psh.slice(-8).reverse().map(x => `<div><span>${UI.fdate(x.d)}</span><b>${UI.price(x.amount, cur)}</b></div>`).join('')}</div>` : ''}`}

      <h2><span>MI POSICIÓN</span></h2>
      <div class="kv">
        <div class="k">${isC ? 'CANTIDAD' : 'ACCIONES'}</div><div class="v">${p ? UI.qtyFmt(p.qty) : 0}</div>
        <div class="k">PRECIO MEDIO</div><div class="v">${held ? UI.price(p.avgLocal, cur) : '—'}</div>
        <div class="k">COSTE</div><div class="v">${held ? UI.eur(p.costEur) : '—'}</div>
        <div class="k">VALOR</div><div class="v">${r && r.value != null ? UI.eur(r.value) : '—'}</div>
        <div class="k">P/L</div><div class="v ${UI.cls(r && r.pl)}">${r && r.pl != null ? UI.sEur(r.pl) + ' (' + UI.sPct(r.plPct) + ')' : '—'}</div>
        <div class="k">PESO</div><div class="v">${r && total ? UI.fnum(r.value / total * 100, 2) + '%' : '—'}</div>
        <div class="k">PLUSVALÍAS REALIZADAS</div><div class="v ${UI.cls(p ? Object.values(p.realized).reduce((s, v) => s + v, 0) : 0)}">${p ? UI.sEur(Object.values(p.realized).reduce((s, v) => s + v, 0)) : '—'}</div>
        ${isC ? '' : `<div class="k">DIVIDENDOS COBRADOS</div><div class="v yellow">${UI.eur(myDivSum)}</div>`}
      </div>

      ${isC ? '' : `<h2><span>MIS DIVIDENDOS · ${myDivs.length}</span><span class="muted">TOCA PARA EDITAR</span></h2>
      <div class="rows">${myDivs.slice(0, 40).map(d => `<div class="row" data-div="${UI.esc(d.id)}">
        <div class="mid"><div class="tk yellow" style="font-size:12px">${DTYPE[d.type] || 'DIVIDENDO'}${d.status === 'pending' ? '<span class="tag yellow">PENDIENTE</span>' : ''}</div>
        <div class="nm">${UI.fdate(d.date)}${d.withholding ? ' · ret. ' + UI.eur(d.withholding) : ''}</div></div>
        <div class="rt"><div class="val yellow">${UI.eur(d.net || 0)}</div></div></div>`).join('') || '<div class="muted" style="padding:12px 0">SIN DIVIDENDOS</div>'}</div>`}

      <h2><span>OPERACIONES · ${txs.length}</span><span class="muted">TOCA PARA EDITAR</span></h2>
      <div class="rows">${txs.map(x => `<div class="row" data-tx="${UI.esc(x.id)}">
        <div class="mid"><div class="tk ${x.type === 'sell' ? 'down' : x.type === 'buy' ? 'up' : 'cyan'}" style="font-size:12px">${TYPE[x.type] || x.type}</div>
        <div class="nm">${UI.fdate(x.date)} · ${UI.qtyFmt(x.qty)} × ${UI.price(x.price, x.currency)}</div></div>
        <div class="rt"><div class="val">${UI.eur(x.totalEur || 0)}</div></div></div>`).join('') || '<div class="muted" style="padding:12px 0">SIN OPERACIONES</div>'}</div>

      <h2><span>INFORMACIÓN</span></h2>
      <div class="kv">
        <div class="k">SECTOR</div><div class="v">${UI.esc(a.sector || '—')} / ${UI.esc(a.subsector || '—')}</div>
        <div class="k">PAÍS</div><div class="v">${UI.esc(a.country || '—')}</div>
        <div class="k">DIVISA</div><div class="v">${UI.esc(cur || '—')}</div>
        <div class="k">BROKER</div><div class="v">${UI.esc(brokers.join(', ') || '—')}</div>
        <div class="k">CARTERA</div><div class="v purple">${UI.esc(a.portfolio || '—')}${a.highYield ? ' · ALTO RENDIMIENTO' : ''}</div>
        ${inf.industry ? `<div class="k">INDUSTRIA</div><div class="v">${UI.esc(inf.industry)}</div>` : ''}
      </div>`;

    // Gráfico
    const drawChart = () => {
      const pts = pricePoints(a, st.fichaRange);
      const marks = (p ? p.txs : []).filter(x => x.type === 'buy' || x.type === 'sell').map(x => ({ d: x.date, type: x.type }));
      const pc = $('#fpc', bg), pv = $('#fpv', bg);
      const ch = pts.length > 1 ? pts[pts.length - 1].v / pts[0].v - 1 : null;
      if (pc && ch != null) { pc.className = UI.cls(ch); pc.textContent = UI.sPct(ch) + ' ' + st.fichaRange; }
      lineChart($('#fch', bg), pts, {
        loading, marks, ref: held && !isC ? p.avgLocal : null,
        onScrub: pt => {
          if (!pt) { pv.textContent = q ? UI.price(q.price, cur) : '—'; if (ch != null) { pc.className = UI.cls(ch); pc.textContent = UI.sPct(ch) + ' ' + st.fichaRange; } return; }
          pv.textContent = UI.price(pt.v, cur);
          const c2 = pt.v / pts[0].v - 1;
          pc.className = UI.cls(c2); pc.textContent = UI.fdate(pt.d) + ' · ' + UI.sPct(c2);
        }
      });
    };
    drawChart();
    bg.querySelectorAll('[data-fr]').forEach(b => b.onclick = () => {
      st.fichaRange = b.dataset.fr;
      bg.querySelectorAll('[data-fr]').forEach(x => x.classList.toggle('on', x === b));
      drawChart();
    });
    const F = window.Forms;
    const go = fn => { bg.remove(); fn(); };
    bg.querySelectorAll('[data-act]').forEach(b => b.onclick = () => go(() => ({
      buy: () => F.openTrade('buy', { asset: a }), sell: () => F.openTrade('sell', { asset: a }),
      div: () => F.openDividend({ asset: a }), scrip: () => F.openScrip({ asset: a }), edit: () => F.openAssetForm({ asset: a })
    })[b.dataset.act]()));
    bg.querySelectorAll('[data-tx]').forEach(el => el.onclick = () => go(() => F.editTx(S.get(el.dataset.tx))));
    bg.querySelectorAll('[data-div]').forEach(el => el.onclick = () => go(() => F.openDividend({ div: S.get(el.dataset.div) })));
  }

  window.Screens = { dividendos: renderDividendos, calendario: renderCalendario, ficha };
})();
