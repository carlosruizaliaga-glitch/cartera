// Formularios del botón "+": COMPRA · VENTA · DIVIDENDO · SCRIP · EMPRESA NUEVA (y editar/borrar).
// Objetivo: menos de 15 segundos. Todo viene precargado; solo se toca lo que cambia.
(function () {
  'use strict';
  const S = window.Store, M = window.Market, C = window.Calc;
  const U = () => window.UI;
  const $ = (sel, el) => el.querySelector(sel);
  const uid = p => p + '-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const EPS = 1e-9;

  // ---------- Números ----------
  function parseNum(s) {
    s = String(s == null ? '' : s).trim().replace(/[\s€$£]/g, '');
    if (!s) return NaN;
    if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
    return parseFloat(s);
  }
  function numStr(n, dec) {
    if (n == null || !isFinite(n)) return '';
    let s = Math.abs(n) < 1e-12 ? '0' : n.toFixed(dec == null ? 2 : dec);
    if (s.includes('.')) s = s.replace(/0+$/, '').replace(/\.$/, '');
    return s.replace('.', ',');
  }
  const priceDec = p => p >= 1 ? 2 : p >= 0.01 ? 4 : 8;
  const addMonths = (iso, n) => { const d = new Date(iso + 'T12:00:00Z'); d.setUTCMonth(d.getUTCMonth() + n); return d.toISOString().slice(0, 10); };

  // ---------- Datos ----------
  const settings = () => S.get('settings') || { withholding: {}, rules: {} };
  const brokers = () => S.list('broker').sort((a, b) => (a.order || 0) - (b.order || 0));
  const txs = () => S.list('tx');
  const assetsAll = () => S.list('asset');
  const withholdingPct = a => {
    const w = settings().withholding || {};
    return a && w[a.country] != null ? +w[a.country] : 0;
  };
  function holdings() { return C.positions(txs()); }
  // Precio de cierre de un día (o el último anterior); hoy -> cotización actual.
  function priceOn(a, day) {
    const q = M.quote(a);
    if (!day || day >= U().today()) return q ? { price: q.price, currency: q.currency } : null;
    const h = M.history(a);
    const days = Object.keys(h.closes).filter(d => d <= day).sort();
    if (days.length) return { price: h.closes[days[days.length - 1]], currency: h.currency };
    return q ? { price: q.price, currency: q.currency } : null;
  }
  const curOf = a => {
    if (a.type === 'crypto') return 'EUR';
    const q = M.quote(a);
    return q ? q.currency : (a.currency || 'EUR');
  };
  function defaultBroker(a) {
    const mine = txs().filter(t => t.asset === a.id && t.broker).sort((x, y) => x.date < y.date ? 1 : -1);
    if (mine.length) return mine[0].broker;
    return a.type === 'crypto' ? 'b-binance' : 'b-degiro';
  }
  // Comisión habitual: la última usada con ese broker y divisa; si no, la del broker.
  function defaultFee(brokerId, cur, amountEur) {
    const b = S.get(brokerId) || {};
    if (b.feePct) return (b.feeFixed || 0) + amountEur * b.feePct / 100;
    const last = txs().filter(t => t.broker === brokerId && t.currency === cur && (t.type === 'buy' || t.type === 'sell') && t.fee > 0)
      .sort((x, y) => x.date < y.date ? 1 : -1)[0];
    return last ? last.fee : (b.feeFixed || 0);
  }

  // ---------- Piezas de interfaz ----------
  const esc = s => U().esc(s);
  function chips(name, options, value) {
    return `<div class="chips" data-chips="${name}">${options.map(o =>
      `<button type="button" data-v="${esc(o[0])}" class="${String(value) === String(o[0]) ? 'on' : ''}">${esc(o[1])}</button>`).join('')}</div>`;
  }
  function bindChips(root, name, cb) {
    const box = root.querySelector(`[data-chips="${name}"]`);
    if (!box) return;
    box.querySelectorAll('button').forEach(b => b.onclick = () => {
      box.querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b));
      cb(b.dataset.v);
    });
  }
  function confirmDelete(btn, action) {
    btn.onclick = () => {
      if (btn.dataset.armed) { action(); return; }
      btn.dataset.armed = '1'; btn.textContent = '¿SEGURO? PULSA OTRA VEZ';
      btn.classList.add('armed');
      setTimeout(() => { if (btn.isConnected) { delete btn.dataset.armed; btn.textContent = 'BORRAR'; btn.classList.remove('armed'); } }, 3500);
    };
  }

  // Selector de activo con autocompletado (tus posiciones primero, luego la watchlist).
  function assetPicker(box, opts) {
    const pos = holdings();
    const heldIds = new Set(Object.values(pos).filter(p => p.qty > 0).map(p => p.asset));
    const mdl = U().model();
    const valueOf = id => { const r = mdl.rows.find(x => x.a.id === id); return r ? r.value || 0 : 0; };
    const pool = assetsAll().filter(a => opts.mode === 'held' ? heldIds.has(a.id) : true);
    let selected = opts.selected || null;

    function draw(q) {
      if (selected) {
        const p = pos[selected.id];
        box.innerHTML = `<div class="pill" id="pk">${U().logoHtml(selected, M.quote(selected))}
          <div class="mid"><div class="tk">${esc(selected.ticker)}</div><div class="nm ellipsis">${esc(selected.name)}${p && p.qty ? ' · tienes ' + U().qtyFmt(p.qty) : ''}</div></div>
          ${opts.locked ? '' : '<span class="muted">CAMBIAR</span>'}</div>`;
        if (!opts.locked) $('#pk', box).onclick = () => { selected = null; draw(''); opts.onPick(null); setTimeout(() => { const i = $('#pq', box); if (i) i.focus(); }, 30); };
        return;
      }
      box.innerHTML = `<input id="pq" class="big-in" type="search" autocomplete="off" autocapitalize="characters" placeholder="${opts.mode === 'held' ? 'BUSCA EN TUS POSICIONES' : 'TICKER O NOMBRE'}" value="${esc(q || '')}">
        <div class="picks" id="pl"></div>`;
      const inp = $('#pq', box);
      const list = () => {
        const s = inp.value.trim().toLowerCase();
        let res;
        if (!s) res = pool.filter(a => heldIds.has(a.id)).sort((x, y) => valueOf(y.id) - valueOf(x.id));
        else res = pool.map(a => {
          const t = a.ticker.toLowerCase(), n = (a.name || '').toLowerCase();
          const r = t === s ? 0 : t.startsWith(s) ? 1 : n.startsWith(s) ? 2 : t.includes(s) || n.includes(s) ? 3 : 9;
          return [r, a];
        }).filter(x => x[0] < 9).sort((x, y) => x[0] - y[0] || (heldIds.has(y[1].id) - heldIds.has(x[1].id)) || x[1].ticker.localeCompare(y[1].ticker)).map(x => x[1]);
        res = res.slice(0, 8);
        $('#pl', box).innerHTML = res.map(a => `<button type="button" class="pick" data-id="${esc(a.id)}">
            ${U().logoHtml(a, M.quote(a))}<span class="mid"><b>${esc(a.ticker)}</b> <span class="muted">${esc(a.name)}</span></span>
            ${heldIds.has(a.id) ? '<span class="tag cyan">TIENES</span>' : a.type === 'crypto' ? '<span class="tag purple">CRIPTO</span>' : ''}</button>`).join('') +
          (opts.mode !== 'held' && s ? `<button type="button" class="pick new" data-new="1"><span class="mid purple"><b>+ EMPRESA NUEVA «${esc(inp.value.trim().toUpperCase())}»</b></span></button>` : '') +
          (!res.length && opts.mode === 'held' ? '<div class="muted" style="padding:10px 0">Sin coincidencias en tus posiciones.</div>' : '');
        $('#pl', box).querySelectorAll('[data-id]').forEach(b => b.onclick = () => { selected = S.get(b.dataset.id); draw(); opts.onPick(selected); });
        const nb = $('#pl', box).querySelector('[data-new]');
        if (nb) nb.onclick = () => opts.onNew && opts.onNew(inp.value.trim().toUpperCase());
      };
      inp.oninput = list;
      list();
    }
    draw('');
    return { get: () => selected, set: a => { selected = a; draw(); } };
  }

  function formSheet(title, color, body) {
    const bg = U().sheet(`<div class="hd"><div class="t ${color}">${title}</div><button data-close>✕</button></div>
      <form class="f" autocomplete="off" onsubmit="return false">${body}</form>`);
    bg.close = () => { bg.remove(); U().render(); };
    return bg;
  }

  // ======================================================================
  // COMPRA / VENTA
  // ======================================================================
  function openTrade(kind, opts) {
    opts = opts || {};
    const edit = opts.tx || null;
    const isSell = kind === 'sell';
    const st = {
      a: edit ? S.get(edit.asset) : (opts.asset || null),
      date: edit ? edit.date : U().today(),
      qty: edit ? edit.qty : NaN, price: edit ? edit.price : NaN, fx: edit ? edit.fx : NaN, fee: edit ? edit.fee : NaN,
      cur: edit ? edit.currency : null, broker: edit ? edit.broker : null,
      touched: { price: !!edit, fx: !!edit, fee: !!edit }
    };
    const color = isSell ? 'down' : 'up';
    const bg = formSheet((edit ? 'EDITAR ' : '') + (isSell ? '− VENTA' : '+ COMPRA'), color, `
      <div class="fld"><label>ACTIVO</label><div id="asset"></div></div>
      <div id="rest"></div>`);
    const root = bg.querySelector('.f');

    const picker = assetPicker($('#asset', root), {
      mode: isSell ? 'held' : 'all', selected: st.a, locked: !!edit,
      onPick: a => { st.a = a; st.touched = { price: false, fx: false, fee: false }; setup(); },
      onNew: t => { bg.remove(); openAssetForm({ ticker: t, then: a => openTrade(kind, { asset: a }) }); }
    });

    function fillDefaults() {
      const a = st.a;
      st.cur = edit ? st.cur : curOf(a);
      if (!st.touched.price) { const p = priceOn(a, st.date); if (p) { st.price = p.price; st.cur = p.currency || st.cur; } }
      if (!st.touched.fx) st.fx = M.rateOn(st.cur, st.date) || st.fx || 1;
      if (!st.broker || !edit) st.broker = st.broker && st.touched.broker ? st.broker : defaultBroker(a);
      if (!st.touched.fee) st.fee = defaultFee(st.broker, st.cur, amountEur());
    }
    const amountEur = () => (isFinite(st.qty) && isFinite(st.price) && st.fx > 0) ? st.qty * st.price / st.fx : 0;
    const totalEur = () => isSell ? amountEur() - (st.fee || 0) : amountEur() + (st.fee || 0);

    function setup() {
      const rest = $('#rest', root);
      if (!st.a) { rest.innerHTML = ''; return; }
      fillDefaults();
      const a = st.a;
      const p = holdings()[a.id];
      const avail = p ? p.qty + (edit && isSell ? edit.qty : 0) : 0;
      const needLoad = !M.quote(a);
      rest.innerHTML = `
        <div class="grid2">
          <div class="fld"><label>FECHA</label><input id="date" type="date" value="${st.date}" max="${U().today()}"></div>
          <div class="fld"><label>${a.type === 'crypto' ? 'CANTIDAD' : 'ACCIONES'}${isSell ? ` <span class="muted">/ ${U().qtyFmt(avail)}</span>` : ''}</label>
            <div class="inrow"><input id="qty" inputmode="decimal" placeholder="0" value="${numStr(st.qty, 8)}">${isSell ? '<button type="button" id="all" class="mini">TODO</button>' : ''}</div></div>
          <div class="fld"><label>PRECIO <span class="muted">${esc(st.cur)}</span>${needLoad ? ' <span class="yellow" id="ld">CARGANDO…</span>' : ''}</label><input id="price" inputmode="decimal" value="${numStr(st.price, 8)}"></div>
          <div class="fld"><label>CAMBIO BCE <span class="muted">1 € = ${esc(st.cur)}</span></label><input id="fx" inputmode="decimal" value="${st.cur === 'EUR' ? '1' : numStr(st.fx, 5)}" ${st.cur === 'EUR' ? 'disabled' : ''}></div>
        </div>
        <div class="fld"><label>BROKER</label>${chips('broker', brokers().map(b => [b.id, b.name.toUpperCase()]), st.broker)}</div>
        <div class="fld"><label>COMISIÓN €</label><input id="fee" inputmode="decimal" value="${numStr(st.fee, 2)}"></div>
        <div class="sum" id="sum"></div>
        <div id="warn"></div>
        <div class="actions">
          ${edit ? '<button type="button" id="del" class="danger">BORRAR</button>' : ''}
          <button type="button" id="save" class="primary ${isSell ? 'sell' : ''}">${edit ? 'GUARDAR CAMBIOS' : isSell ? '− GUARDAR VENTA' : '+ GUARDAR COMPRA'}</button>
        </div>`;
      const qtyIn = $('#qty', rest), priceIn = $('#price', rest), fxIn = $('#fx', rest), feeIn = $('#fee', rest);
      qtyIn.oninput = () => { st.qty = parseNum(qtyIn.value); if (!st.touched.fee && (S.get(st.broker) || {}).feePct) { st.fee = defaultFee(st.broker, st.cur, amountEur()); feeIn.value = numStr(st.fee, 2); } summary(); };
      priceIn.oninput = () => { st.price = parseNum(priceIn.value); st.touched.price = true; summary(); };
      fxIn.oninput = () => { st.fx = parseNum(fxIn.value); st.touched.fx = true; summary(); };
      feeIn.oninput = () => { st.fee = parseNum(feeIn.value) || 0; st.touched.fee = true; summary(); };
      $('#date', rest).onchange = e => {
        st.date = e.target.value || U().today();
        if (!st.touched.price) { const pp = priceOn(a, st.date); if (pp) { st.price = pp.price; priceIn.value = numStr(st.price, 8); } }
        if (!st.touched.fx) { st.fx = M.rateOn(st.cur, st.date) || st.fx; fxIn.value = st.cur === 'EUR' ? '1' : numStr(st.fx, 5); }
        summary();
      };
      bindChips(rest, 'broker', v => { st.broker = v; st.touched.broker = true; if (!st.touched.fee) { st.fee = defaultFee(v, st.cur, amountEur()); feeIn.value = numStr(st.fee, 2); } summary(); });
      const allBtn = $('#all', rest);
      if (allBtn) allBtn.onclick = () => { st.qty = avail; qtyIn.value = numStr(avail, 8); summary(); };
      $('#save', rest).onclick = save;
      if (edit) confirmDelete($('#del', rest), () => { S.remove('tx', edit); U().toast('Operación borrada'); bg.close(); });
      summary();
      if (!edit && !isFinite(st.qty)) setTimeout(() => qtyIn.focus(), 60);

      if (needLoad) {
        M.load([a], { history: true, from: C.addDays(U().today(), -400) }).then(() => {
          if (!bg.isConnected || st.a !== a) return;
          fillDefaults();
          const ld = $('#ld', rest); if (ld) ld.remove();
          if (!st.touched.price) priceIn.value = numStr(st.price, 8);
          if (!st.touched.fx) fxIn.value = st.cur === 'EUR' ? '1' : numStr(st.fx, 5);
          summary();
        }).catch(() => { const ld = $('#ld', rest); if (ld) { ld.textContent = 'SIN PRECIO: ESCRÍBELO'; ld.className = 'down'; } });
      }
    }

    function others() { return txs().filter(t => !edit || t.id !== edit.id); }
    function summary() {
      const rest = $('#rest', root);
      const sum = $('#sum', rest), warn = $('#warn', rest);
      if (!sum) return;
      const a = st.a, UI = U();
      const lines = [];
      lines.push(['IMPORTE', isFinite(st.qty) && isFinite(st.price) ? UI.price(st.qty * st.price, st.cur) : '—']);
      lines.push([isSell ? 'RECIBES' : 'TOTAL', UI.eur(totalEur())]);
      let w = '';
      if (isSell && isFinite(st.qty) && st.qty > 0) {
        const sim = C.simulateSale(others(), a.id, st.qty, totalEur());
        if (sim) {
          lines.push(['COSTE FIFO', UI.eur(sim.cost)]);
          lines.push(['PLUSVALÍA', `<span class="${UI.cls(sim.pl)}">${UI.sEur(sim.pl)} (${UI.sPct(sim.cost ? sim.pl / sim.cost : 0)})</span>`]);
          if (sim.short > EPS) w += `<div class="warn red">VENDES MÁS DE LO QUE TIENES (${UI.qtyFmt(sim.available)}).</div>`;
          if (sim.pl < 0 && a.type !== 'crypto') {
            const from = addMonths(st.date, -2), to = addMonths(st.date, 2);
            const recent = others().filter(t => t.asset === a.id && t.type === 'buy' && t.date >= from && t.date <= st.date);
            w += recent.length
              ? `<div class="warn">REGLA DE 2 MESES: compraste ${esc(a.ticker)} el ${recent.map(t => UI.fdate(t.date)).join(', ')}. La pérdida de ${UI.sEur(sim.pl)} no se podrá compensar en la renta hasta que vendas esas acciones.</div>`
              : `<div class="warn">REGLA DE 2 MESES: vendes con pérdida. Si vuelves a comprar ${esc(a.ticker)} antes del ${UI.fdate(to)}, la pérdida quedará diferida.</div>`;
          }
        }
      }
      if (!isSell && a.type !== 'crypto') {
        const pp = C.positions(others().filter(t => t.asset === a.id))[a.id];
        const from = addMonths(st.date, -2);
        const lossy = pp ? pp.sales.filter(s => s.pl < 0 && s.tx.date >= from && s.tx.date <= st.date) : [];
        if (lossy.length) w += `<div class="warn">REGLA DE 2 MESES: vendiste ${esc(a.ticker)} con pérdida el ${lossy.map(s => UI.fdate(s.tx.date) + ' (' + UI.sEur(s.pl) + ')').join(', ')}. Con esta compra esa pérdida queda diferida.</div>`;
      }
      sum.innerHTML = lines.map(l => `<div class="k">${l[0]}</div><div class="v">${l[1]}</div>`).join('');
      warn.innerHTML = w;
    }

    function save() {
      const a = st.a;
      if (!a) return U().toast('Elige un activo');
      if (!(st.qty > 0)) return U().toast('Pon la cantidad');
      if (!(st.price >= 0)) return U().toast('Pon el precio');
      if (!(st.fx > 0)) return U().toast('Pon el tipo de cambio');
      if (isSell) {
        const sim = C.simulateSale(others(), a.id, st.qty, totalEur());
        if (!sim || sim.short > EPS) return U().toast('No tienes tantas: revisa la cantidad');
      }
      const tx = {
        id: edit ? edit.id : uid('t'), asset: a.id, type: isSell ? 'sell' : 'buy', date: st.date,
        qty: st.qty, price: st.price, currency: st.cur, fx: st.cur === 'EUR' ? 1 : st.fx, fee: st.fee || 0,
        broker: st.broker, totalEur: Math.round(totalEur() * 1e6) / 1e6, src: edit ? (edit.src || 'app') : 'app'
      };
      S.put('tx', tx);
      U().toast(`${isSell ? 'VENTA' : 'COMPRA'} GUARDADA · ${a.ticker} ${U().qtyFmt(st.qty)} × ${U().price(st.price, st.cur)}`);
      bg.close();
    }
    setup();
  }

  // ======================================================================
  // DIVIDENDO
  // ======================================================================
  const DIV_TYPES = [['dividend', 'DIVIDENDO'], ['scrip', 'SCRIP (EFECTIVO)'], ['substitute', 'SUSTITUCIÓN']];
  function estimateDividend(a, day) {
    const p = C.positions(txs().filter(t => t.asset === a.id && t.date <= day))[a.id];
    const qty = p ? p.qty : 0;
    const divs = M.dividends(a);
    let per = divs.length ? divs[divs.length - 1].amount : null;
    if (per == null && a.divAnnual) per = a.divAnnual / Math.max(1, (a.divMonths || []).length || 4);
    if (!qty || !per) return null;
    const cur = a.type === 'crypto' ? 'EUR' : curOf(a);
    const r = M.rateOn(cur, day) || 1;
    const w = withholdingPct(a) / 100;
    const gross = qty * per / r;
    return { qty, per, cur, gross, net: gross * (1 - w), w };
  }
  function openDividend(opts) {
    opts = opts || {};
    const edit = opts.div || null;
    const st = {
      a: edit ? S.get(edit.asset) : (opts.asset || null),
      type: edit ? edit.type : 'dividend', date: edit ? edit.date : U().today(),
      net: edit ? edit.net : NaN, gross: edit ? edit.gross : NaN, ret: edit ? edit.withholding : NaN,
      touchedGross: !!edit, broker: edit ? edit.broker : null
    };
    const pendingConfirm = edit && edit.status === 'pending';
    const bg = formSheet(pendingConfirm ? 'CONFIRMAR DIVIDENDO' : (edit ? 'EDITAR DIVIDENDO' : '$ DIVIDENDO'), 'yellow', `
      <div class="fld"><label>EMPRESA</label><div id="asset"></div></div>
      <div id="rest"></div>`);
    const root = bg.querySelector('.f');
    assetPicker($('#asset', root), {
      mode: 'all', selected: st.a, locked: !!edit,
      onPick: a => { st.a = a; setup(); },
      onNew: t => { bg.remove(); openAssetForm({ ticker: t, then: a => openDividend({ asset: a }) }); }
    });

    function setup() {
      const rest = $('#rest', root);
      if (!st.a) { rest.innerHTML = ''; return; }
      const a = st.a, UI = U();
      const w = withholdingPct(a);
      if (!st.broker) st.broker = defaultBroker(a);
      rest.innerHTML = `
        <div class="fld"><label>TIPO</label>${chips('type', DIV_TYPES, st.type)}</div>
        <div class="grid2">
          <div class="fld"><label>FECHA DE PAGO</label><input id="date" type="date" value="${st.date}"></div>
          <div class="fld"><label>NETO RECIBIDO €</label><input id="net" class="hl" inputmode="decimal" placeholder="0,00" value="${numStr(st.net, 2)}"></div>
        </div>
        <div id="est"></div>
        <div class="grid2">
          <div class="fld"><label>BRUTO €</label><input id="gross" inputmode="decimal" value="${numStr(st.gross, 2)}"></div>
          <div class="fld"><label>RETENCIÓN € <span class="muted">${UI.fnum(w, w % 1 ? 1 : 0)}%</span></label><input id="ret" inputmode="decimal" value="${numStr(st.ret, 2)}"></div>
        </div>
        <div class="fld"><label>BROKER</label>${chips('broker', brokers().map(b => [b.id, b.name.toUpperCase()]), st.broker)}</div>
        <div class="actions">
          ${edit ? '<button type="button" id="del" class="danger">BORRAR</button>' : ''}
          <button type="button" id="save" class="primary gold">${pendingConfirm ? '✓ CONFIRMAR' : edit ? 'GUARDAR CAMBIOS' : '$ GUARDAR DIVIDENDO'}</button>
        </div>`;
      const netIn = $('#net', rest), grossIn = $('#gross', rest), retIn = $('#ret', rest);
      const recompute = () => {
        if (st.touchedGross || !isFinite(st.net)) return;
        st.gross = w < 100 ? st.net / (1 - w / 100) : st.net;
        st.ret = st.gross - st.net;
        grossIn.value = numStr(st.gross, 2); retIn.value = numStr(st.ret, 2);
      };
      netIn.oninput = () => { st.net = parseNum(netIn.value); recompute(); };
      grossIn.oninput = () => { st.gross = parseNum(grossIn.value); st.touchedGross = true; if (isFinite(st.net)) { st.ret = st.gross - st.net; retIn.value = numStr(st.ret, 2); } };
      retIn.oninput = () => { st.ret = parseNum(retIn.value); st.touchedGross = true; if (isFinite(st.net)) { st.gross = st.net + (st.ret || 0); grossIn.value = numStr(st.gross, 2); } };
      $('#date', rest).onchange = e => { st.date = e.target.value || UI.today(); drawEstimate(); };
      bindChips(rest, 'type', v => { st.type = v; });
      bindChips(rest, 'broker', v => { st.broker = v; });
      $('#save', rest).onclick = save;
      if (edit) confirmDelete($('#del', rest), () => { S.remove('dividend', edit); UI.toast('Dividendo borrado'); bg.close(); });

      function drawEstimate() {
        const e = estimateDividend(a, st.date);
        const box = $('#est', rest);
        if (!e) { box.innerHTML = ''; return; }
        box.innerHTML = `<button type="button" class="estim" id="use">ESTIMADO: ${UI.qtyFmt(e.qty)} × ${UI.price(e.per, e.cur)}${e.w ? ' − ' + UI.fnum(e.w * 100, 0) + '%' : ''} = <b>${UI.eur(e.net)}</b> <span class="cyan">USAR ›</span></button>`;
        $('#use', box).onclick = () => { st.net = Math.round(e.net * 100) / 100; netIn.value = numStr(st.net, 2); st.touchedGross = false; recompute(); };
      }
      drawEstimate();
      if (!M.dividends(a).length && a.type !== 'crypto') M.load([a], { history: true, from: C.addDays(UI.today(), -400) }).then(() => { if (bg.isConnected) drawEstimate(); }).catch(() => {});
      recompute();
      if (!edit) setTimeout(() => netIn.focus(), 60);
    }

    function save() {
      const a = st.a;
      if (!a) return U().toast('Elige la empresa');
      if (!(st.net > 0)) return U().toast('Pon el neto recibido');
      const gross = isFinite(st.gross) ? st.gross : st.net;
      const d = Object.assign({}, edit || {}, {
        id: edit ? edit.id : uid('d'), asset: a.id, type: st.type, date: st.date,
        gross: Math.round(gross * 100) / 100, withholding: Math.round(Math.max(0, gross - st.net) * 100) / 100,
        withholdingEs: edit ? edit.withholdingEs || 0 : 0, fee: edit ? edit.fee || 0 : 0,
        net: Math.round(st.net * 100) / 100, currency: 'EUR', fx: 1, broker: st.broker,
        status: 'confirmed', netImported: false
      });
      S.put('dividend', d);
      U().toast(`DIVIDENDO GUARDADO · ${a.ticker} ${U().eur(d.net)}`);
      bg.close();
    }
    setup();
  }

  // ======================================================================
  // SCRIP (acciones gratis)
  // ======================================================================
  function openScrip(opts) {
    opts = opts || {};
    const edit = opts.tx || null;
    const st = { a: edit ? S.get(edit.asset) : (opts.asset || null), date: edit ? edit.date : U().today(), qty: edit ? edit.qty : NaN };
    const bg = formSheet(edit ? 'EDITAR SCRIP' : '⟳ SCRIP', 'cyan', `
      <div class="fld"><label>EMPRESA</label><div id="asset"></div></div>
      <div id="rest"></div>`);
    const root = bg.querySelector('.f');
    assetPicker($('#asset', root), { mode: 'held', selected: st.a, locked: !!edit, onPick: a => { st.a = a; setup(); } });
    function setup() {
      const rest = $('#rest', root);
      if (!st.a) { rest.innerHTML = ''; return; }
      rest.innerHTML = `
        <div class="grid2">
          <div class="fld"><label>FECHA</label><input id="date" type="date" value="${st.date}"></div>
          <div class="fld"><label>ACCIONES RECIBIDAS</label><input id="qty" class="hl" inputmode="decimal" placeholder="0" value="${numStr(st.qty, 8)}"></div>
        </div>
        <div class="sum" id="sum"></div>
        <div class="actions">
          ${edit ? '<button type="button" id="del" class="danger">BORRAR</button>' : ''}
          <button type="button" id="save" class="primary cyanbg">${edit ? 'GUARDAR CAMBIOS' : '⟳ GUARDAR SCRIP'}</button>
        </div>`;
      const qtyIn = $('#qty', rest);
      const sum = () => {
        const UI = U(), a = st.a;
        const base = C.positions(txs().filter(t => t.asset === a.id && (!edit || t.id !== edit.id)))[a.id];
        const q0 = base ? base.qty : 0, avg0 = base ? base.avgLocal : 0;
        const q1 = q0 + (st.qty > 0 ? st.qty : 0);
        const cur = curOf(a);
        $('#sum', rest).innerHTML = `<div class="k">ACCIONES</div><div class="v">${UI.qtyFmt(q0)} → <b>${UI.qtyFmt(q1)}</b></div>
          <div class="k">PRECIO MEDIO</div><div class="v">${UI.price(avg0, cur)} → <b class="up">${UI.price(q1 ? avg0 * q0 / q1 : 0, cur)}</b></div>`;
      };
      qtyIn.oninput = () => { st.qty = parseNum(qtyIn.value); sum(); };
      $('#date', rest).onchange = e => { st.date = e.target.value || U().today(); };
      $('#save', rest).onclick = () => {
        if (!(st.qty > 0)) return U().toast('Pon las acciones recibidas');
        const a = st.a;
        S.put('tx', { id: edit ? edit.id : uid('t'), asset: a.id, type: 'scrip', date: st.date, qty: st.qty, price: 0,
          currency: curOf(a), fx: 1, fee: 0, broker: edit ? edit.broker : defaultBroker(a), totalEur: 0, src: edit ? edit.src : 'app' });
        U().toast(`SCRIP GUARDADO · ${a.ticker} +${U().qtyFmt(st.qty)}`);
        bg.close();
      };
      if (edit) confirmDelete($('#del', rest), () => { S.remove('tx', edit); U().toast('Scrip borrado'); bg.close(); });
      sum();
      if (!edit) setTimeout(() => qtyIn.focus(), 60);
    }
    setup();
  }

  // ======================================================================
  // EMPRESA NUEVA / EDITAR EMPRESA
  // ======================================================================
  const MARKETS = [['US', 'NYSE/NASDAQ', ''], ['BME', 'BME', '.MC'], ['EPA', 'PARÍS', '.PA'], ['ETR', 'XETRA', '.DE'], ['SWX', 'SUIZA', '.SW'],
    ['LON', 'LONDRES', '.L'], ['AMS', 'AMSTERDAM', '.AS'], ['MIL', 'MILÁN', '.MI'], ['HKG', 'HONG KONG', '.HK'], ['TSX', 'TORONTO', '.TO'], ['CRIPTO', 'CRIPTO', null]];
  const MARKET_COUNTRY = { US: 'EEUU', BME: 'España', EPA: 'Francia', ETR: 'Alemania', SWX: 'Suiza', LON: 'UK', AMS: 'Holanda', MIL: 'Italia', HKG: 'China', TSX: 'Canadá' };
  const SECTOR_MAP = {
    'Consumer Defensive': ['Defensivo', 'Cons. defensivo'], 'Healthcare': ['Defensivo', 'Salud'], 'Utilities': ['Defensivo', 'Utilidades'],
    'Technology': ['Sensitivo', 'Tecnología'], 'Communication Services': ['Sensitivo', 'Serv. de comunic.'], 'Industrials': ['Sensitivo', 'Industrial'],
    'Energy': ['Sensitivo', 'Energía'], 'Financial Services': ['Cíclico', 'Serv. financieros'], 'Real Estate': ['Cíclico', 'Bienes raíces'],
    'Consumer Cyclical': ['Cíclico', 'Cons. cíclico'], 'Basic Materials': ['Cíclico', 'Materias primas']
  };
  const COUNTRY_MAP = { 'United States': 'EEUU', 'Spain': 'España', 'France': 'Francia', 'Germany': 'Alemania', 'Switzerland': 'Suiza',
    'United Kingdom': 'UK', 'Netherlands': 'Holanda', 'Canada': 'Canadá', 'China': 'China', 'Hong Kong': 'China', 'Italy': 'Italia',
    'Ireland': 'Irlanda', 'Belgium': 'Bélgica', 'Denmark': 'Dinamarca', 'Portugal': 'Portugal', 'Japan': 'Japón', 'Australia': 'Australia',
    'Sweden': 'Suecia', 'Norway': 'Noruega', 'Finland': 'Finlandia', 'Luxembourg': 'Luxemburgo', 'Taiwan': 'Taiwán', 'Bermuda': 'Bermudas' };
  const MONTHS = ['E', 'F', 'M', 'A', 'M', 'J', 'J', 'A', 'S', 'O', 'N', 'D'];
  const marketOfAsset = a => a.type === 'crypto' ? 'CRIPTO' : (a.market === 'NYSE' || a.market === 'NASDAQ' || a.market === 'OTCMKTS' ? 'US' : a.market || 'US');

  function openAssetForm(opts) {
    opts = opts || {};
    const edit = opts.asset || null;
    const f = edit ? Object.assign({}, edit) : {
      ticker: (opts.ticker || '').replace(/[^A-Z0-9.\-]/gi, '').toUpperCase(), market: 'US', type: 'stock', name: '', country: '', currency: '',
      sector: '', subsector: '', portfolio: 'DGI', divAnnual: 0, divMonths: [], highYield: false, yahoo: '', coingecko: null
    };
    let mk = edit ? marketOfAsset(edit) : (opts.market || 'US');
    let found = !!edit;
    const bg = formSheet(edit ? 'EDITAR ' + esc(edit.ticker) : '◆ EMPRESA NUEVA', 'purple', `<div id="step"></div>`);
    const root = bg.querySelector('.f');

    function drawSearch(msg, results) {
      $('#step', root).innerHTML = `
        <div class="fld"><label>TICKER</label><input id="tk" class="big-in" autocapitalize="characters" placeholder="P. EJ. KO, ITX, ETH" value="${esc(f.ticker)}"></div>
        <div class="fld"><label>MERCADO</label>${chips('mk', MARKETS.map(m => [m[0], m[1]]), mk)}</div>
        <div class="muted" id="msg">${msg || 'Pon el ticker y el mercado. La app rellena el resto.'}</div>
        <div class="picks" id="res">${(results || []).map((r, i) => `<button type="button" class="pick" data-i="${i}">
          ${r.image ? `<div class="logo"><img src="${esc(r.image)}" alt=""></div>` : ''}<span class="mid"><b>${esc(r.symbol)}</b> <span class="muted">${esc(r.name)}${r.exchange ? ' · ' + esc(r.exchange) : ''}</span></span></button>`).join('')}</div>
        <div class="actions"><button type="button" id="go" class="primary purplebg">BUSCAR ›</button></div>`;
      const tk = $('#tk', root);
      tk.oninput = () => { f.ticker = tk.value.trim().toUpperCase(); };
      bindChips(root, 'mk', v => { mk = v; });
      $('#go', root).onclick = lookup;
      tk.onkeydown = e => { if (e.key === 'Enter') lookup(); };
      (results || []).forEach((r, i) => { $(`[data-i="${i}"]`, root).onclick = () => pickResult(r); });
      if (!f.ticker) setTimeout(() => tk.focus(), 60);
    }

    async function pickResult(r) {
      if (mk === 'CRIPTO') { f.coingecko = r.id; f.ticker = r.symbol; f.name = r.name; }
      else { f.yahoo = r.symbol; f.name = r.name; }
      await fetchData();
    }

    async function lookup() {
      f.ticker = ($('#tk', root).value || '').trim().toUpperCase();
      if (!f.ticker) return U().toast('Escribe el ticker');
      const dup = assetsAll().find(a => a.ticker === f.ticker && marketOfAsset(a) === mk);
      if (dup && !edit) { bg.remove(); U().toast('Ya existe: te abro su ficha'); U().openAsset(dup.id); return; }
      $('#msg', root).innerHTML = '<span class="yellow">BUSCANDO…</span>';
      try {
        if (mk === 'CRIPTO') {
          const res = await M.search(f.ticker, 'crypto');
          const exact = res.filter(r => r.symbol === f.ticker);
          if (exact.length === 1) return pickResult(exact[0]);
          return drawSearch(res.length ? 'Elige la cripto correcta:' : 'No la encuentro. Revisa el ticker.', res);
        }
        const m = MARKETS.find(x => x[0] === mk);
        f.yahoo = f.ticker.replace(/\./g, '-') + (m ? m[2] : '');
        const ok = await fetchData(true);
        if (!ok) {
          const res = await M.search(f.ticker, 'stock');
          drawSearch(res.length ? 'No la encuentro en ese mercado. ¿Es alguna de estas?' : 'No la encuentro. Revisa ticker y mercado.', res);
        }
      } catch (e) { $('#msg', root).innerHTML = '<span class="down">Sin conexión con los datos de mercado. Inténtalo de nuevo.</span>'; }
    }

    // Descarga precio, ficha y dividendos y rellena el formulario.
    async function fetchData(quiet) {
      const tmp = { id: 'tmp', ticker: f.ticker, type: mk === 'CRIPTO' ? 'crypto' : 'stock', yahoo: mk === 'CRIPTO' ? null : f.yahoo, coingecko: f.coingecko, currency: 'EUR' };
      $('#msg', root) && ($('#msg', root).innerHTML = '<span class="yellow">DESCARGANDO DATOS…</span>');
      await M.load([tmp], { info: tmp.type !== 'crypto', history: true, from: C.addDays(U().today(), -400) });
      const q = M.quote(tmp);
      if (!q) return quiet ? false : (drawSearch('No hay precio para ese valor.'), false);
      if (tmp.type === 'crypto') {
        Object.assign(f, { type: 'crypto', market: 'Cripto', country: 'Cripto', currency: 'EUR', sector: 'Cripto', subsector: f.subsector || 'Blockchain',
          portfolio: 'Cripto', name: f.name || q.name || f.ticker, yahoo: null });
      } else {
        const info = M.info(f.yahoo) || {};
        const sec = SECTOR_MAP[info.sector] || ['', info.sector || ''];
        const divs = M.dividends(tmp).filter(d => d.d >= C.addDays(U().today(), -370));
        const months = [...new Set(divs.map(d => +d.d.slice(5, 7)))].sort((x, y) => x - y);
        const annual = info.divRate != null ? info.divRate : divs.reduce((s, d) => s + d.amount, 0);
        Object.assign(f, {
          name: info.name || q.name || f.name || f.ticker, currency: q.currency || info.currency || 'USD',
          country: COUNTRY_MAP[info.country] || info.country || MARKET_COUNTRY[mk] || '',
          market: mk === 'US' ? (/nasdaq/i.test(info.exchange || '') ? 'NASDAQ' : 'NYSE') : mk,
          sector: sec[0], subsector: sec[1], divAnnual: Math.round((annual || 0) * 10000) / 10000, divMonths: months,
          type: /etf/i.test(q.name || '') && !info.sector ? 'etf' : 'stock', pence: q.currency === 'GBP' && mk === 'LON'
        });
      }
      found = true;
      drawDetails();
      return true;
    }

    function drawDetails() {
      const UI = U();
      const q = M.quote(Object.assign({ type: f.type }, f));
      const isC = f.type === 'crypto';
      $('#step', root).innerHTML = `
        <div class="pill">${UI.logoHtml(f, q)}<div class="mid"><div class="tk">${esc(f.ticker)} <span class="muted">${esc(isC ? f.coingecko : f.yahoo)}</span></div>
          <div class="nm">${q ? UI.price(q.price, q.currency) : 'sin precio'}${edit ? '' : ' · <span class="cyan" id="back">CAMBIAR</span>'}</div></div></div>
        <div class="fld"><label>NOMBRE</label><input id="name" value="${esc(f.name)}"></div>
        ${isC ? '' : `<div class="grid2">
          <div class="fld"><label>PAÍS</label><input id="country" value="${esc(f.country)}"></div>
          <div class="fld"><label>DIVISA</label><input id="currency" value="${esc(f.currency)}" autocapitalize="characters"></div></div>
        <div class="fld"><label>TIPO</label>${chips('type', [['stock', 'ACCIÓN'], ['etf', 'ETF']], f.type)}</div>
        <div class="fld"><label>SECTOR</label>${chips('sector', [['Defensivo', 'DEFENSIVO'], ['Cíclico', 'CÍCLICO'], ['Sensitivo', 'SENSITIVO']], f.sector)}</div>`}
        <div class="fld"><label>SUBSECTOR</label><input id="subsector" value="${esc(f.subsector)}"></div>
        ${isC ? '' : `<div class="fld"><label>CARTERA</label>${chips('portfolio', [['DGI', 'DGI'], ['Comp', 'COMP']], f.portfolio)}</div>
        <div class="grid2">
          <div class="fld"><label>DIVIDENDO ANUAL <span class="muted">${esc(f.currency)}/acc.</span></label><input id="div" inputmode="decimal" value="${numStr(f.divAnnual, 4)}"></div>
          <div class="fld"><label>ALTO RENDIMIENTO</label>${chips('hy', [['0', 'NO'], ['1', 'SÍ (mREIT)']], f.highYield ? '1' : '0')}</div>
        </div>
        <div class="fld"><label>MESES DE PAGO</label><div class="months" id="months">${MONTHS.map((m, i) =>
          `<button type="button" data-m="${i + 1}" class="${(f.divMonths || []).includes(i + 1) ? 'on' : ''}">${m}</button>`).join('')}</div></div>
        <div class="fld"><label>SÍMBOLO YAHOO</label><input id="yahoo" value="${esc(f.yahoo || '')}" autocapitalize="characters"></div>`}
        <div class="actions">
          ${edit && !inUse(edit.id) ? '<button type="button" id="del" class="danger">BORRAR</button>' : ''}
          <button type="button" id="save" class="primary purplebg">${edit ? 'GUARDAR CAMBIOS' : '◆ GUARDAR EMPRESA'}</button>
        </div>`;
      const val = id => { const el = $('#' + id, root); return el ? el.value.trim() : undefined; };
      const back = $('#back', root); if (back) back.onclick = () => drawSearch();
      bindChips(root, 'type', v => { f.type = v; });
      bindChips(root, 'sector', v => { f.sector = v; });
      bindChips(root, 'portfolio', v => { f.portfolio = v; });
      bindChips(root, 'hy', v => { f.highYield = v === '1'; });
      root.querySelectorAll('[data-m]').forEach(b => b.onclick = () => b.classList.toggle('on'));
      if (edit && !inUse(edit.id)) confirmDelete($('#del', root), () => { S.remove('asset', edit); U().toast('Empresa borrada'); bg.close(); });
      $('#save', root).onclick = () => {
        f.name = val('name') || f.ticker;
        if (!isC) {
          f.country = val('country'); f.currency = (val('currency') || 'EUR').toUpperCase();
          f.divAnnual = parseNum(val('div')) || 0;
          f.divMonths = [...root.querySelectorAll('[data-m].on')].map(b => +b.dataset.m);
          f.yahoo = (val('yahoo') || f.yahoo || '').toUpperCase();
        }
        f.subsector = val('subsector');
        const a = Object.assign({}, f, { id: edit ? edit.id : 'a-' + f.ticker + (assetsAll().some(x => x.id === 'a-' + f.ticker) ? '-' + Date.now().toString(36) : '') });
        S.put('asset', a);
        U().toast(edit ? 'EMPRESA ACTUALIZADA' : `${a.ticker} AÑADIDA A SEGUIMIENTO`);
        bg.remove();
        if (opts.then) opts.then(a); else U().render();
      };
    }
    function inUse(id) { return txs().some(t => t.asset === id) || S.list('dividend').some(d => d.asset === id); }

    if (edit) drawDetails();
    else if (f.ticker) { drawSearch(); if (opts.ticker) lookup(); }
    else drawSearch();
  }

  // ---------- Menú "+" ----------
  function openAdd() {
    const bg = U().sheet(`<div class="hd"><div class="t">AÑADIR</div><button data-close>✕</button></div>
      <div class="menu">
        <button data-k="buy"><span class="up">+ COMPRA</span><span class="s">Acciones, ETF o cripto</span></button>
        <button data-k="sell"><span class="down">− VENTA</span><span class="s">FIFO automático y regla de 2 meses</span></button>
        <button data-k="div"><span class="yellow">$ DIVIDENDO</span><span class="s">Dividendo, scrip en efectivo o sustitución</span></button>
        <button data-k="scrip"><span class="cyan">⟳ SCRIP</span><span class="s">Acciones gratis: bajan tu precio medio</span></button>
        <button data-k="asset"><span class="purple">◆ EMPRESA NUEVA</span><span class="s">Solo ticker y mercado</span></button>
      </div>`);
    bg.querySelectorAll('[data-k]').forEach(b => b.onclick = () => {
      bg.remove();
      ({ buy: () => openTrade('buy'), sell: () => openTrade('sell'), div: () => openDividend(), scrip: () => openScrip(), asset: () => openAssetForm() })[b.dataset.k]();
    });
  }
  function editTx(tx) {
    if (tx.type === 'scrip') openScrip({ tx });
    else if (tx.type === 'buy' || tx.type === 'sell') openTrade(tx.type, { tx });
    else U().toast('Las recompensas cripto se editan desde la copia de seguridad');
  }

  window.Forms = { openAdd, openTrade, openDividend, openScrip, openAssetForm, editTx, parseNum, numStr, estimateDividend };
})();
