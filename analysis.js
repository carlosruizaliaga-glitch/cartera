// Pantalla ANÁLISIS: distribución, reglas (alertas) y resumen FISCAL para la renta.
(function () {
  'use strict';
  const S = window.Store, M = window.Market, C = window.Calc;
  const U = () => window.UI;
  const COLORS = ['var(--green)', 'var(--yellow)', 'var(--cyan)', 'var(--purple)', 'var(--orange)', 'var(--red)', '#e8f1ef', '#6f8fa6', '#e59ac6', '#9fe3d3', '#93a8a6'];
  const st = { view: 'dist', dim: 'sector', year: null, mapa: 'peso', col: 'day', scale: 'lin' };
  const settings = () => S.get('settings') || { withholding: {}, rules: {} };
  const rules = () => Object.assign({ maxPerCompany: 7, maxHighYield: 5, maxCrypto: 5 }, settings().rules || {});
  const addMonths = (iso, n) => { const d = new Date(iso + 'T12:00:00Z'); d.setUTCMonth(d.getUTCMonth() + n); return d.toISOString().slice(0, 10); };

  // ---------- Distribución ----------
  const DIMS = [['sector', 'SECTOR'], ['grupo', 'ESTILO'], ['pais', 'PAÍS'], ['divisa', 'DIVISA'], ['broker', 'BROKER'], ['tipo', 'TIPO'], ['cartera', 'CARTERA']];
  function keyOf(r, dim) {
    const a = r.a, isC = a.type === 'crypto';
    switch (dim) {
      case 'sector': return isC ? 'Cripto' : (a.subsector || a.sector || 'Sin sector');
      case 'grupo': return isC ? 'Cripto' : (a.sector || 'Sin clasificar');
      case 'pais': return isC ? 'Cripto' : (a.country || '—');
      case 'divisa': return isC ? 'USD (cripto)' : ((r.q && r.q.currency) || a.currency || '—');
      case 'broker': { const t = r.p.txs.filter(x => x.broker).slice(-1)[0]; return t ? ((S.get(t.broker) || {}).name || t.broker) : '—'; }
      case 'tipo': return isC ? 'Cripto' : a.type === 'etf' ? 'ETF' : 'Acción';
      case 'cartera': return isC ? 'Cripto' : (a.portfolio || '—');
    }
    return '—';
  }
  function distribution(rows, dim) {
    const tot = rows.reduce((s, r) => s + (r.value || 0), 0);
    const g = {};
    rows.forEach(r => {
      const k = keyOf(r, dim);
      (g[k] = g[k] || { k, v: 0, items: [] }).v += r.value || 0;
      g[k].items.push(r);
    });
    return { tot, groups: Object.values(g).sort((x, y) => y.v - x.v).map((x, i) => Object.assign(x, { w: tot ? x.v / tot : 0, color: COLORS[i % COLORS.length] })) };
  }
  function renderDist(rows) {
    const UI = U();
    const d = distribution(rows, st.dim);
    return `
      <div class="chips" style="margin-top:12px">${DIMS.map(x => `<button data-dim="${x[0]}" class="${st.dim === x[0] ? 'on' : ''}">${x[1]}</button>`).join('')}</div>
      <div class="stack">${d.groups.map(g => `<i style="width:${(g.w * 100).toFixed(2)}%;background:${g.color}"></i>`).join('')}</div>
      <div class="dist">${d.groups.map(g => `<div class="dg">
        <div class="dh"><i class="sq" style="background:${g.color}"></i><b>${UI.esc(g.k)}</b><span class="v">${UI.eur(g.v, 0)}</span><span class="w">${UI.fnum(g.w * 100, 1)}%</span></div>
        <div class="dbar"><i style="width:${(g.w * 100).toFixed(2)}%;background:${g.color}"></i></div>
        <div class="dtk">${g.items.sort((x, y) => (y.value || 0) - (x.value || 0)).map(r => `<span data-id="${UI.esc(r.a.id)}">${UI.esc(r.a.ticker)} <em>${UI.fnum(d.tot ? r.value / d.tot * 100 : 0, 1)}%</em></span>`).join('')}</div>
      </div>`).join('')}</div>`;
  }

  // ---------- Reglas ----------
  function renderRules(rows) {
    const UI = U(), R = rules();
    const tot = rows.reduce((s, r) => s + (r.value || 0), 0);
    const w = r => tot ? (r.value || 0) / tot : 0;
    const big = rows.filter(r => w(r) * 100 > R.maxPerCompany).sort((x, y) => w(y) - w(x));
    const hy = rows.filter(r => r.a.highYield);
    const hyW = hy.reduce((s, r) => s + w(r), 0);
    const cr = rows.filter(r => r.a.type === 'crypto');
    const crW = cr.reduce((s, r) => s + w(r), 0);
    const card = (key, title, desc, ok, body) => `<div class="rule ${ok ? 'ok' : 'bad'}">
      <div class="rh"><span class="st">${ok ? '✓ OK' : '✕ INCUMPLE'}</span><b>${title}</b>
        <label class="thr">MÁX <input data-rule="${key}" inputmode="decimal" value="${UI.fnum(R[key], R[key] % 1 ? 1 : 0)}">%</label></div>
      <div class="muted rd">${desc}</div>${body}</div>`;
    const excess = (r, max) => (r.value || 0) - tot * max / 100;
    return `
      <div class="muted" style="margin:12px 0 4px;font-size:12px">Toca el porcentaje para cambiar el umbral.</div>
      ${card('maxPerCompany', 'PESO POR EMPRESA', `Ninguna posición por encima del ${UI.fnum(R.maxPerCompany, 1)}% de la cartera.`, !big.length,
        big.length ? `<div class="rows">${big.map(r => `<div class="row" data-id="${UI.esc(r.a.id)}">
          <div class="mid"><div class="tk">${UI.esc(r.a.ticker)}</div><div class="nm">sobran ~${UI.eur(excess(r, R.maxPerCompany), 0)} para bajar al ${UI.fnum(R.maxPerCompany, 1)}%</div></div>
          <div class="rt"><div class="val down">${UI.fnum(w(r) * 100, 1)}%</div></div></div>`).join('')}</div>` : '')}
      ${card('maxHighYield', 'mREIT / ALTO RENDIMIENTO', `Empresas marcadas como alto rendimiento (tipo AGNC): máx. ${UI.fnum(R.maxHighYield, 1)}% en total. Se marcan en ✎ EDITAR de cada empresa.`, hyW * 100 <= R.maxHighYield,
        `<div class="meter"><i style="width:${Math.min(100, hyW * 100 / Math.max(R.maxHighYield, 0.1) * 50)}%" class="${hyW * 100 > R.maxHighYield ? 'bad' : ''}"></i><s style="left:50%"></s></div>
        <div class="kv"><div class="k">AHORA</div><div class="v ${hyW * 100 > R.maxHighYield ? 'down' : 'up'}">${UI.fnum(hyW * 100, 1)}% · ${UI.eur(hy.reduce((s, r) => s + (r.value || 0), 0), 0)}</div>
        <div class="k">EMPRESAS</div><div class="v">${UI.esc(hy.map(r => r.a.ticker).join(', ') || '—')}</div>
        ${hyW * 100 > R.maxHighYield ? `<div class="k">PARA CUMPLIR</div><div class="v">vender ~${UI.eur(hy.reduce((s, r) => s + (r.value || 0), 0) - tot * R.maxHighYield / 100, 0)}</div>` : ''}</div>`)}
      ${card('maxCrypto', 'CRIPTO', `Cripto como máximo el ${UI.fnum(R.maxCrypto, 1)}% de la cartera.`, crW * 100 <= R.maxCrypto,
        `<div class="meter"><i style="width:${Math.min(100, crW * 100 / Math.max(R.maxCrypto, 0.1) * 50)}%" class="${crW * 100 > R.maxCrypto ? 'bad' : ''}"></i><s style="left:50%"></s></div>
        <div class="kv"><div class="k">AHORA</div><div class="v ${crW * 100 > R.maxCrypto ? 'down' : 'up'}">${UI.fnum(crW * 100, 1)}% · ${UI.eur(cr.reduce((s, r) => s + (r.value || 0), 0), 0)}</div>
        ${crW * 100 > R.maxCrypto ? `<div class="k">PARA CUMPLIR</div><div class="v">vender ~${UI.eur(cr.reduce((s, r) => s + (r.value || 0), 0) - tot * R.maxCrypto / 100, 0)}</div>` : ''}</div>`)}`;
  }

  // ---------- Fiscal ----------
  function fiscalYear(year) {
    const assets = {}; S.list('asset').forEach(a => { assets[a.id] = a; });
    const txs = S.list('tx');
    const pos = C.positions(txs);
    const W = settings().withholding || {};
    // Ventas del año (FIFO)
    const sales = [];
    Object.values(pos).forEach(p => p.sales.forEach(s => {
      if (+s.tx.date.slice(0, 4) !== year) return;
      const a = assets[p.asset] || { ticker: '?', type: 'stock' };
      let deferred = 0, rebuy = [];
      if (s.pl < 0 && a.type !== 'crypto') {
        // Regla de 2 meses: recompras de la misma acción 2 meses antes o después (que no son los lotes vendidos).
        const from = addMonths(s.tx.date, -2), to = addMonths(s.tx.date, 2);
        const soldLots = new Set(s.lots.map(l => l.date));
        rebuy = txs.filter(t => t.asset === p.asset && (t.type === 'buy' || t.type === 'scrip') && t.date >= from && t.date <= to && t.id !== s.tx.id && !(t.date <= s.tx.date && soldLots.has(t.date)));
        const q = rebuy.reduce((x, t) => x + t.qty, 0);
        if (q > 0) deferred = s.pl * Math.min(1, q / s.tx.qty);
      }
      sales.push({ a, s, deferred, rebuy });
    }));
    sales.sort((x, y) => x.s.tx.date < y.s.tx.date ? -1 : 1);
    const sum = arr => arr.reduce((x, v) => x + v, 0);
    const part = list => ({
      gains: sum(list.filter(x => x.s.pl > 0).map(x => x.s.pl)), losses: sum(list.filter(x => x.s.pl < 0).map(x => x.s.pl)),
      proceeds: sum(list.map(x => x.s.proceeds)), cost: sum(list.map(x => x.s.cost)), deferred: sum(list.map(x => x.deferred)), n: list.length
    });
    const stocks = part(sales.filter(x => x.a.type !== 'crypto')), crypto = part(sales.filter(x => x.a.type === 'crypto'));
    // Dividendos del año
    const divs = S.list('dividend').filter(d => d.status !== 'pending' && +d.date.slice(0, 4) === year);
    const byCountry = {};
    let importedNet = 0;
    divs.forEach(d => {
      const a = assets[d.asset] || {};
      const c = a.country || '—';
      const w = (W[c] || 0) / 100;
      let gross = d.gross || d.net, ret = d.withholding || 0, est = false;
      // Importados de la hoja netos (sin retención apuntada): estimamos el bruto con la retención del país.
      if (d.netImported && !ret && w > 0 && c !== '—') { gross = d.net / (1 - w); ret = gross - d.net; est = true; importedNet++; }
      const b = byCountry[c] || (byCountry[c] = { c, gross: 0, ret: 0, net: 0, fee: 0, n: 0, est: 0 });
      b.gross += gross; b.ret += ret; b.net += d.net || 0; b.fee += d.fee || 0; b.n++; if (est) b.est++;
    });
    const countries = Object.values(byCountry).sort((x, y) => y.gross - x.gross);
    const dm = settings().deductibleMax != null ? settings().deductibleMax / 100 : 0.15;
    countries.forEach(b => {
      b.spain = b.c === 'España';
      b.deductible = b.spain ? 0 : Math.min(b.ret, b.gross * dm);        // deducción doble imposición (casilla 0588)
      b.spanishRet = b.spain ? b.ret : 0;                                 // retenciones españolas (pagos a cuenta)
      b.excess = b.spain ? 0 : Math.max(0, b.ret - b.gross * dm);         // recuperable en el país de origen
    });
    const expenses = S.list('expense').filter(e => +e.date.slice(0, 4) === year);
    return { year, sales, stocks, crypto, countries, importedNet, expenses,
      divGross: sum(countries.map(b => b.gross)), divRet: sum(countries.map(b => b.ret)), divNet: sum(countries.map(b => b.net)),
      divFees: sum(countries.map(b => b.fee)), deductible: sum(countries.map(b => b.deductible)), spanishRet: sum(countries.map(b => b.spanishRet)),
      excess: countries.filter(b => b.excess > 0.005), expTotal: sum(expenses.map(e => e.amount)) };
  }

  function renderFiscal() {
    const UI = U(), t = UI.today();
    const years = [...new Set([...S.list('tx').filter(x => x.type === 'sell').map(x => +x.date.slice(0, 4)), ...S.list('dividend').map(d => +d.date.slice(0, 4))])].sort();
    const cy = +t.slice(0, 4);
    if (!years.includes(cy)) years.push(cy);
    if (!st.year) st.year = cy;
    const f = fiscalYear(st.year);
    const net = f.stocks.gains + f.stocks.losses;
    const saleRow = x => `<div class="row" data-id="${UI.esc(x.a.id || '')}">
      <div class="mid"><div class="tk">${UI.esc(x.a.ticker)} <span class="muted" style="font-weight:400;font-size:11px">${UI.fdate(x.s.tx.date)}</span>${x.deferred ? '<span class="tag yellow">2 MESES</span>' : ''}</div>
        <div class="nm">${UI.qtyFmt(x.s.tx.qty)} acc. · transmisión ${UI.eur(x.s.proceeds)} · adquisición ${UI.eur(x.s.cost)}</div>
        ${x.deferred ? `<div class="nm yellow">Pérdida diferida ${UI.eur(x.deferred)}: recompra el ${x.rebuy.map(r => UI.fdate(r.date)).join(', ')}</div>` : ''}</div>
      <div class="rt"><div class="val ${UI.cls(x.s.pl)}">${UI.sEur(x.s.pl)}</div></div></div>`;
    return `
      <div class="chips" style="margin-top:12px">${years.map(y => `<button data-fy="${y}" class="${st.year === y ? 'on' : ''}">${y}</button>`).join('')}</div>
      ${st.year === cy ? '<div class="warn" style="margin-top:10px">AÑO EN CURSO: los datos pueden cambiar hasta el 31/12.</div>' : ''}

      <h2><span>GANANCIAS Y PÉRDIDAS · ACCIONES Y ETF</span></h2>
      <div class="kv" style="margin-top:10px">
        <div class="k">VALOR DE TRANSMISIÓN</div><div class="v">${UI.eur(f.stocks.proceeds)}</div>
        <div class="k">VALOR DE ADQUISICIÓN</div><div class="v">${UI.eur(f.stocks.cost)}</div>
        <div class="k">PLUSVALÍAS</div><div class="v up">${UI.sEur(f.stocks.gains)}</div>
        <div class="k">MINUSVALÍAS</div><div class="v down">${UI.sEur(f.stocks.losses)}</div>
        <div class="k">RESULTADO NETO (FIFO)</div><div class="v ${UI.cls(net)}"><b>${UI.sEur(net)}</b></div>
        ${f.stocks.deferred ? `<div class="k">PÉRDIDA DIFERIDA (2 MESES)</div><div class="v yellow">${UI.sEur(-f.stocks.deferred)}</div>
        <div class="k">COMPUTABLE ESTE AÑO</div><div class="v ${UI.cls(net - f.stocks.deferred)}"><b>${UI.sEur(net - f.stocks.deferred)}</b></div>` : ''}
      </div>
      <div class="rows">${f.sales.filter(x => x.a.type !== 'crypto').map(saleRow).join('') || '<div class="muted" style="padding:10px 0">Sin ventas de acciones este año.</div>'}</div>

      ${f.crypto.n ? `<h2><span>GANANCIAS Y PÉRDIDAS · CRIPTO</span></h2>
      <div class="kv" style="margin-top:10px">
        <div class="k">TRANSMISIÓN</div><div class="v">${UI.eur(f.crypto.proceeds)}</div>
        <div class="k">ADQUISICIÓN</div><div class="v">${UI.eur(f.crypto.cost)}</div>
        <div class="k">RESULTADO NETO</div><div class="v ${UI.cls(f.crypto.gains + f.crypto.losses)}"><b>${UI.sEur(f.crypto.gains + f.crypto.losses)}</b></div>
      </div>
      <div class="rows">${f.sales.filter(x => x.a.type === 'crypto').map(saleRow).join('')}</div>` : ''}

      <h2><span>DIVIDENDOS (RENDIMIENTOS DEL CAPITAL MOBILIARIO)</span></h2>
      <div class="kv" style="margin-top:10px">
        <div class="k">INGRESOS ÍNTEGROS (BRUTO)</div><div class="v"><b>${UI.eur(f.divGross)}</b></div>
        <div class="k">RETENCIÓN EN ORIGEN</div><div class="v">${UI.eur(f.divRet)}</div>
        ${f.divFees ? `<div class="k">COMISIONES</div><div class="v">${UI.eur(f.divFees)}</div>` : ''}
        <div class="k">NETO COBRADO</div><div class="v yellow">${UI.eur(f.divNet)}</div>
        <div class="k">RETENCIONES ESPAÑOLAS</div><div class="v">${UI.eur(f.spanishRet)}</div>
        <div class="k">DEDUCIBLE DOBLE IMPOSICIÓN (MÁX 15%)</div><div class="v up"><b>${UI.eur(f.deductible)}</b></div>
        ${f.expTotal ? `<div class="k">GASTOS DE CUSTODIA/CONECTIVIDAD</div><div class="v">${UI.eur(f.expTotal)}</div>` : ''}
      </div>
      <div class="ctry">${f.countries.map(b => `<div><b>${UI.esc(b.c)}</b><span>${b.n} pagos</span><span>bruto ${UI.eur(b.gross)}</span><span>ret. ${UI.eur(b.ret)}</span>
        <span class="${b.spain ? '' : 'up'}">${b.spain ? 'retención española' : 'deducible ' + UI.eur(b.deductible)}</span>${b.est ? '<span class="yellow">bruto estimado*</span>' : ''}</div>`).join('')}</div>
      ${f.importedNet ? `<div class="warn">* ${f.importedNet} dividendos vienen de tu hoja apuntados NETOS (sin retención). Aquí se estima su bruto con la retención de cada país. Para la declaración, usa las cifras del informe fiscal anual de DeGiro.</div>` : ''}

      ${f.excess.length ? `<h2><span class="yellow">RETENCIÓN RECUPERABLE</span></h2>
      ${f.excess.map(b => `<div class="warn">${UI.esc(b.c.toUpperCase())}: te retuvieron ${UI.eur(b.ret)} y en España solo deduces el 15% (${UI.eur(b.deductible)}). Puedes reclamar ~${UI.eur(b.excess)} a ${b.c === 'Francia' ? 'Francia (formularios 5000 y 5001)' : b.c === 'Suiza' ? 'Suiza (formulario 86 de la AFC)' : 'ese país'}.</div>`).join('')}` : ''}

      <div class="muted" style="font-size:11px;margin-top:16px">Resumen orientativo calculado con tus apuntes (FIFO, cambio BCE de cada operación). No sustituye al informe fiscal del broker.</div>`;
  }

  // ---------- Mapa (treemap tipo Finviz) ----------
  function squarify(items, X, Y, W, H) {
    const tot = items.reduce((s, i) => s + i.v, 0), out = [];
    if (!tot || W <= 0 || H <= 0) return out;
    const its = items.map(i => Object.assign({}, i, { a: i.v / tot * W * H })).sort((p, q) => q.a - p.a);
    let x = X, y = Y, w = W, h = H, row = [];
    const worst = (r, side) => { const sm = r.reduce((s, i) => s + i.a, 0), mx = r[0].a, mn = r[r.length - 1].a; return Math.max(side * side * mx / (sm * sm), sm * sm / (side * side * mn)); };
    const layout = r => {
      const sm = r.reduce((s, i) => s + i.a, 0);
      if (w >= h) { const cw = sm / h; let cy = y; r.forEach(i => { const ch = i.a / cw; out.push(Object.assign(i, { x, y: cy, w: cw, h: ch })); cy += ch; }); x += cw; w -= cw; }
      else { const ch = sm / w; let cx = x; r.forEach(i => { const cw = i.a / ch; out.push(Object.assign(i, { x: cx, y, w: cw, h: ch })); cx += cw; }); y += ch; h -= ch; }
    };
    its.forEach(i => {
      const side = Math.min(w, h);
      if (!row.length || worst(row.concat(i), side) <= worst(row, side)) row.push(i);
      else { layout(row); row = [i]; }
    });
    if (row.length) layout(row);
    return out;
  }
  // p en "puntos": -3 rojo pleno, 0 neutro, +3 verde pleno
  const tileColor = p => {
    const t = Math.max(-1, Math.min(1, (p || 0) / 3)), k = Math.abs(t);
    const n = [38, 55, 58], tgt = t >= 0 ? [20, 163, 127] : [214, 69, 77];
    const c = n.map((v, i) => Math.round(v + (tgt[i] - v) * (k ? 0.3 + 0.7 * k : 0)));
    return `rgb(${c[0]},${c[1]},${c[2]})`;
  };
  function renderMapa(rows) {
    const UI = U(), M = window.Market;
    const total = rows.reduce((s, r) => s + (r.value || 0), 0);
    const byCap = st.mapa === 'cap';
    const sc = v => st.scale === 'sqrt' ? Math.sqrt(v) : v;
    const items = [], missing = [];
    rows.forEach(r => {
      if (r.value == null) return;
      let size = r.value;
      if (byCap) {
        const inf = r.a.yahoo && M.info(r.a.yahoo);
        const rate = (r.q && M.rate(r.q.currency)) || 1;
        const cap = r.a.type === 'crypto' ? (r.q && r.q.mcap) : (inf && inf.marketCap ? inf.marketCap / rate : null);
        if (!cap) { missing.push(r.a.ticker); return; }
        size = cap;
      }
      const chg = st.col === 'pl' ? (r.plPct != null ? r.plPct * 10 : 0) : (r.dayPct != null ? r.dayPct * 100 : 0);
      items.push({ v: sc(size), r, size, chg });
    });
    const W = 360, H = 380;
    const tiles = squarify(items, 0, 0, W, H);
    const lbl = i => { const dp = st.col === 'pl' ? i.r.plPct : i.r.dayPct; return dp == null ? '' : (dp >= 0 ? '+' : '−') + UI.fnum(Math.abs(dp) * 100, 1) + '%'; };
    const html = tiles.map(t => {
      const big = t.w > 54 && t.h > 36, mid = t.w > 30 && t.h > 20;
      const sub = byCap ? UI.fnum(t.size / 1e9, t.size >= 1e10 ? 0 : 1) + ' mil M' : UI.fnum(t.size / (total || 1) * 100, 1) + '%';
      return `<div class="tile" data-id="${UI.esc(t.r.a.id)}" style="left:${(t.x / W * 100).toFixed(3)}%;top:${(t.y / H * 100).toFixed(3)}%;width:${(t.w / W * 100).toFixed(3)}%;height:${(t.h / H * 100).toFixed(3)}%;background:${tileColor(t.chg)}">${mid ? `<b style="font-size:${Math.max(9, Math.min(20, Math.sqrt(t.w * t.h) / 4.2)).toFixed(1)}px">${UI.esc(t.r.a.ticker)}</b>` : ''}${big ? `<span>${lbl(t)}</span><em>${sub}</em>` : ''}</div>`;
    }).join('');
    const btn = (k, cur, list) => `<div class="seg sm">${list.map(o => `<button data-${k}="${o[0]}" class="${cur === o[0] ? 'on' : ''}">${o[1]}</button>`).join('')}</div>`;
    return `${btn('mapa', st.mapa, [['peso', 'POR PESO'], ['cap', 'POR CAPITALIZACIÓN']])}
      ${btn('mcol', st.col, [['day', 'COLOR: HOY'], ['pl', 'COLOR: P/L']])}
      ${byCap ? btn('mscale', st.scale, [['lin', 'ESCALA REAL'], ['sqrt', 'ESCALA SUAVE']]) : ''}
      <div class="tm">${html || '<div class="soon">SIN DATOS</div>'}</div>
      <div class="tmleg"><i style="background:${tileColor(-3)}"></i>−3%<i style="background:${tileColor(0)}"></i>0<i style="background:${tileColor(3)}"></i>+3%<span>${st.col === 'pl' ? 'P/L latente (±30 % satura)' : 'Cambio de hoy'}</span></div>
      <div class="muted" style="font-size:11.5px;margin-top:8px">${byCap
        ? 'El tamaño de cada cuadro es el valor de mercado de la empresa (lo que vale entera en bolsa), no tu dinero: así ves en qué tamaño de compañía estás.' + (st.scale === 'sqrt' ? ' Escala suave: se comprime la diferencia para que las pequeñas se vean.' : '')
        : 'El tamaño de cada cuadro es lo que pesa la posición en tu cartera.'}${missing.length ? `<br>Sin dato de capitalización: ${missing.map(UI.esc).join(', ')}.` : ''}</div>`;
  }

  // ---------- Pantalla ----------
  function render() {
    const UI = U();
    const rows = UI.model().rows;
    const body = st.view === 'dist' ? renderDist(rows) : st.view === 'rules' ? renderRules(rows) : st.view === 'mapa' ? renderMapa(rows) : renderFiscal();
    const R = rules(), tot = rows.reduce((s, r) => s + (r.value || 0), 0);
    const nBad = (rows.some(r => tot && r.value / tot * 100 > R.maxPerCompany) ? 1 : 0)
      + (rows.filter(r => r.a.highYield).reduce((s, r) => s + r.value, 0) / (tot || 1) * 100 > R.maxHighYield ? 1 : 0)
      + (rows.filter(r => r.a.type === 'crypto').reduce((s, r) => s + r.value, 0) / (tot || 1) * 100 > R.maxCrypto ? 1 : 0);
    UI.shell(`
      <div class="seg">${[['dist', 'DISTRIBUCIÓN'], ['mapa', 'MAPA'], ['rules', 'REGLAS' + (nBad ? ' · ' + nBad : '')], ['fiscal', 'FISCAL']].map(o =>
        `<button data-av="${o[0]}" class="${st.view === o[0] ? 'on' : ''}">${o[1]}</button>`).join('')}</div>
      ${body}`);
    const app = document.getElementById('app');
    app.querySelectorAll('[data-av]').forEach(b => b.onclick = () => { st.view = b.dataset.av; UI.render(); });
    app.querySelectorAll('[data-mapa]').forEach(b => b.onclick = () => { st.mapa = b.dataset.mapa; UI.render(); });
    app.querySelectorAll('[data-mcol]').forEach(b => b.onclick = () => { st.col = b.dataset.mcol; UI.render(); });
    app.querySelectorAll('[data-mscale]').forEach(b => b.onclick = () => { st.scale = b.dataset.mscale; UI.render(); });
    app.querySelectorAll('.tile[data-id]').forEach(el => el.onclick = () => UI.openAsset(el.dataset.id));
    app.querySelectorAll('[data-dim]').forEach(b => b.onclick = () => { st.dim = b.dataset.dim; UI.render(); });
    app.querySelectorAll('[data-fy]').forEach(b => b.onclick = () => { st.year = +b.dataset.fy; UI.render(); });
    app.querySelectorAll('[data-id]').forEach(el => el.onclick = () => el.dataset.id && UI.openAsset(el.dataset.id));
    app.querySelectorAll('[data-rule]').forEach(inp => inp.onchange = () => {
      const v = window.Forms.parseNum(inp.value);
      if (!(v > 0 && v <= 100)) { UI.toast('Pon un porcentaje entre 0 y 100'); return; }
      const s = Object.assign({}, settings());
      s.rules = Object.assign({}, rules(), { [inp.dataset.rule]: v });
      S.put('settings', s);
      UI.toast('UMBRAL GUARDADO: ' + UI.fnum(v, 1) + '%');
    });
  }

  window.Analysis = { render, fiscalYear, distribution };
})();
