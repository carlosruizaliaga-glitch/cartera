// Pantalla AJUSTES: brokers, retenciones, reglas, copia de seguridad (Excel / CSV / copia completa) y sesión.
(function () {
  'use strict';
  const S = window.Store, M = window.Market, C = window.Calc;
  const U = () => window.UI;
  const $ = (sel, el) => (el || document).querySelector(sel);
  const pnum = s => window.Forms.parseNum(s);
  const settings = () => S.get('settings') || { id: 'settings', withholding: {}, rules: {}, deductibleMax: 15 };
  const saveSettings = patch => S.put('settings', Object.assign({}, settings(), patch));
  const lastBackup = () => { try { return +localStorage.getItem('cartera.lastBackup') || 0; } catch (e) { return 0; } };
  const markBackup = () => { try { localStorage.setItem('cartera.lastBackup', String(Date.now())); } catch (e) { /* sin almacenamiento */ } };

  // ---------- Descargar / compartir un archivo ----------
  async function shareOrDownload(filename, blob) {
    try {
      const file = new File([blob], filename, { type: blob.type });
      if (navigator.canShare && navigator.canShare({ files: [file] })) { await navigator.share({ files: [file], title: filename }); markBackup(); return; }
    } catch (err) { if (err && err.name === 'AbortError') return; }
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    markBackup();
  }
  const stamp = () => U().today();

  // ---------- Tablas para exportar ----------
  function tables() {
    const assets = {}; S.list('asset').forEach(a => { assets[a.id] = a; });
    const brokers = {}; S.list('broker').forEach(b => { brokers[b.id] = b.name; });
    const tk = id => (assets[id] || {}).ticker || id;
    const txs = C.sortTx(S.list('tx'));
    const TYPE = { buy: 'Compra', sell: 'Venta', scrip: 'Scrip', earn: 'Recompensa' };
    const DTYPE = { dividend: 'Dividendo', scrip: 'Scrip', substitute: 'Sustitución' };
    const mdl = U().model();
    const total = mdl.rows.reduce((s, r) => s + (r.value || 0), 0);
    const r2 = n => n == null ? null : Math.round(n * 100) / 100;
    const pos = [['Ticker', 'Nombre', 'Tipo', 'Cantidad', 'Precio medio', 'Precio actual', 'Divisa', 'Coste €', 'Valor €', 'P/L €', 'P/L %', 'Peso %']]
      .concat(mdl.rows.map(r => [r.a.ticker, r.a.name, r.a.type === 'crypto' ? 'Cripto' : r.a.type === 'etf' ? 'ETF' : 'Acción', r.p.qty,
        r.p.avgLocal, r.q ? r.q.price : null, r.q ? r.q.currency : r.a.currency, r2(r.p.costEur), r2(r.value), r2(r.pl),
        r.plPct != null ? r2(r.plPct * 100) : null, total ? r2(r.value / total * 100) : null]));
    const ops = [['Fecha', 'Ticker', 'Tipo', 'Cantidad', 'Precio', 'Divisa', 'Cambio BCE', 'Comisión €', 'Total €', 'Broker', 'Origen', 'ID']]
      .concat(txs.map(t => [t.date, tk(t.asset), TYPE[t.type] || t.type, t.qty, t.price, t.currency, t.fx, t.fee, r2(t.totalEur), brokers[t.broker] || t.broker, t.src || '', t.id]));
    const divs = [['Fecha pago', 'Ticker', 'Tipo', 'Bruto €', 'Retención origen €', 'Comisión €', 'Neto €', 'Estado', 'Broker', 'Neto importado de la hoja', 'ID']]
      .concat(S.list('dividend').sort((x, y) => x.date < y.date ? -1 : 1).map(d => [d.date, tk(d.asset), DTYPE[d.type] || d.type, d.gross, d.withholding, d.fee || 0, d.net,
        d.status === 'pending' ? 'Pendiente' : 'Confirmado', brokers[d.broker] || d.broker || '', d.netImported ? 'Sí' : '', d.id]));
    const pv = [['Fecha venta', 'Ticker', 'Cantidad', 'Transmisión €', 'Adquisición €', 'Resultado €', 'Año']];
    Object.values(C.positions(S.list('tx'))).forEach(p => p.sales.forEach(s => pv.push([s.tx.date, tk(p.asset), s.tx.qty, r2(s.proceeds), r2(s.cost), r2(s.pl), +s.tx.date.slice(0, 4)])));
    pv.splice(1, pv.length, ...pv.slice(1).sort((x, y) => x[0] < y[0] ? -1 : 1));
    const emp = [['Ticker', 'Nombre', 'Tipo', 'Mercado', 'Símbolo Yahoo', 'CoinGecko', 'País', 'Divisa', 'Estilo', 'Subsector', 'Cartera', 'Div. anual/acc.', 'Meses de pago', 'Alto rendimiento']]
      .concat(S.list('asset').sort((x, y) => x.ticker.localeCompare(y.ticker)).map(a => [a.ticker, a.name, a.type === 'crypto' ? 'Cripto' : a.type === 'etf' ? 'ETF' : 'Acción',
        a.market, a.yahoo || '', a.coingecko || '', a.country, a.currency, a.sector, a.subsector, a.portfolio, a.divAnnual || 0, (a.divMonths || []).join(','), a.highYield ? 'Sí' : '']));
    const gas = [['Fecha', 'Concepto', 'Importe €', 'Broker']].concat(S.list('expense').sort((x, y) => x.date < y.date ? -1 : 1).map(e => [e.date, e.concept, e.amount, brokers[e.broker] || '']));
    const brk = [['Broker', 'Comisión fija €', 'Comisión %']].concat(S.list('broker').map(b => [b.name, b.feeFixed || 0, b.feePct || 0]));
    const W = settings().withholding || {};
    const ret = [['País', 'Retención origen %']].concat(Object.keys(W).sort().map(c => [c, W[c]]));
    return { pos, ops, divs, pv, emp, gas, brk, ret };
  }

  function exportExcel() {
    const t = tables();
    const blob = window.Xlsx.build([
      { name: 'Posiciones', rows: t.pos }, { name: 'Operaciones', rows: t.ops }, { name: 'Dividendos', rows: t.divs },
      { name: 'Plusvalías', rows: t.pv }, { name: 'Empresas', rows: t.emp }, { name: 'Gastos', rows: t.gas },
      { name: 'Brokers', rows: t.brk }, { name: 'Retenciones', rows: t.ret }
    ]);
    shareOrDownload(`cartera-carlos-${stamp()}.xlsx`, blob);
  }
  // CSV para Excel en español: separador ";" y coma decimal.
  function csv(rows) {
    const cell = v => {
      if (v == null) return '';
      if (typeof v === 'number') return String(v).replace('.', ',');
      if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return v.slice(8, 10) + '/' + v.slice(5, 7) + '/' + v.slice(0, 4);
      const s = String(v);
      return /[;"\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    };
    return '﻿' + rows.map(r => r.map(cell).join(';')).join('\r\n');
  }
  const exportCsv = which => {
    const t = tables();
    shareOrDownload(`cartera-carlos-${which}-${stamp()}.csv`, new Blob([csv(which === 'operaciones' ? t.ops : t.divs)], { type: 'text/csv;charset=utf-8' }));
  };
  const exportJson = () => shareOrDownload(`cartera-carlos-copia-${stamp()}.json`,
    new Blob([JSON.stringify({ app: 'cartera-carlos', version: 1, date: new Date().toISOString(), items: S.exportAll() })], { type: 'application/json' }));

  function importJson(file) {
    if (!file) return;
    const r = new FileReader();
    r.onload = () => {
      try {
        const data = JSON.parse(r.result);
        if (data.app !== 'cartera-carlos' || !Array.isArray(data.items)) throw new Error('no es una copia de Cartera Carlos');
        const n = data.items.filter(i => !i.deleted);
        const count = k => n.filter(i => i.kind === k).length;
        const bg = U().sheet(`<div class="hd"><div class="t">RESTAURAR COPIA</div><button data-close>✕</button></div>
          <div class="kv"><div class="k">FECHA DE LA COPIA</div><div class="v">${data.date ? U().fdate(data.date.slice(0, 10)) : '—'}</div>
          <div class="k">EMPRESAS / OPERACIONES / DIVIDENDOS</div><div class="v">${count('asset')} / ${count('tx')} / ${count('dividend')}</div></div>
          <div class="warn">Se combinará con tus datos actuales y se subirá a la nube. Si un dato existe en los dos sitios, gana la copia.</div>
          <div class="actions"><button class="primary block" id="doimp">RESTAURAR</button></div>`);
        $('#doimp', bg).onclick = () => {
          const items = data.items.map(i => ({ id: i.id, kind: i.kind, data: i.data, deleted: i.deleted }));
          S.putMany(items); bg.remove(); U().toast('COPIA RESTAURADA'); U().render();
        };
      } catch (e) { U().toast('No se pudo leer: ' + e.message); }
    };
    r.readAsText(file);
  }

  // ---------- Formularios pequeños ----------
  function openBroker(b) {
    const UI = U();
    const inUse = b && (S.list('tx').some(t => t.broker === b.id) || S.list('dividend').some(d => d.broker === b.id));
    const bg = UI.sheet(`<div class="hd"><div class="t">${b ? 'EDITAR BROKER' : '+ BROKER'}</div><button data-close>✕</button></div>
      <form class="f" onsubmit="return false">
        <div class="fld"><label>NOMBRE</label><input id="bn" value="${UI.esc(b ? b.name : '')}" placeholder="P. EJ. INTERACTIVE BROKERS"></div>
        <div class="grid2">
          <div class="fld"><label>COMISIÓN FIJA €</label><input id="bf" inputmode="decimal" value="${b ? window.Forms.numStr(b.feeFixed || 0, 2) : '0'}"></div>
          <div class="fld"><label>COMISIÓN %</label><input id="bp" inputmode="decimal" value="${b ? window.Forms.numStr(b.feePct || 0, 3) : '0'}"></div>
        </div>
        <div class="muted" style="font-size:11.5px;margin-top:8px">Si pones un %, se calcula sobre el importe. Si no, se propone la última comisión que pagaste con ese broker (o la fija).</div>
        <div class="actions">${b && !inUse ? '<button type="button" id="bdel" class="danger">BORRAR</button>' : ''}<button type="button" id="bsave" class="primary">GUARDAR</button></div>
      </form>`);
    $('#bsave', bg).onclick = () => {
      const name = $('#bn', bg).value.trim();
      if (!name) return UI.toast('Pon el nombre');
      const order = b ? b.order : S.list('broker').length + 1;
      S.put('broker', { id: b ? b.id : 'b-' + name.toLowerCase().replace(/[^a-z0-9]+/g, '-') + '-' + Date.now().toString(36).slice(-3),
        name, feeFixed: pnum($('#bf', bg).value) || 0, feePct: pnum($('#bp', bg).value) || 0, order });
      bg.remove(); UI.toast('BROKER GUARDADO'); UI.render();
    };
    const del = $('#bdel', bg);
    if (del) del.onclick = () => { S.remove('broker', b); bg.remove(); UI.toast('Broker borrado'); UI.render(); };
  }

  // ---------- Pantalla ----------
  function render() {
    const UI = U();
    const st = settings();
    const W = st.withholding || {};
    const R = Object.assign({ maxPerCompany: 7, maxHighYield: 5, maxCrypto: 5 }, st.rules || {});
    const n = { a: S.list('asset').length, t: S.list('tx').length, d: S.list('dividend').length };
    const lb = lastBackup();
    const old = !lb || Date.now() - lb > 30 * 86400000;
    const brokers = S.list('broker').sort((x, y) => (x.order || 0) - (y.order || 0));
    UI.shell(`
      <h2><span>COPIA DE SEGURIDAD</span><span class="${old ? 'yellow' : 'muted'}">${lb ? 'ÚLTIMA ' + UI.fdate(new Date(lb).toLocaleDateString('sv-SE')) : 'NUNCA'}</span></h2>
      ${old ? '<div class="warn">Haz una copia de vez en cuando (por ejemplo, una al mes) y guárdala en Drive o mándatela por email.</div>' : ''}
      <div class="bk">
        <button id="xExcel" class="primary">⬇ EXCEL COMPLETO (.xlsx)</button>
        <div class="bk2"><button id="xOps">CSV OPERACIONES</button><button id="xDivs">CSV DIVIDENDOS</button></div>
        <div class="bk2"><button id="xJson">COPIA PARA RESTAURAR</button><button id="xImp">RESTAURAR COPIA</button></div>
        <input type="file" id="impFile" accept=".json,application/json" hidden>
      </div>

      <h2><span>BROKERS</span><span class="tog" id="addB">+ AÑADIR</span></h2>
      <div class="rows">${brokers.map(b => `<div class="row" data-b="${UI.esc(b.id)}"><div class="mid"><div class="tk">${UI.esc(b.name)}</div>
        <div class="nm">${b.feePct ? UI.fnum(b.feePct, 3).replace(/,?0+$/, '') + '% del importe' : 'última comisión usada · por defecto ' + UI.eur(b.feeFixed || 0)}</div></div>
        <div class="rt muted">EDITAR ›</div></div>`).join('')}</div>

      <h2><span>RETENCIÓN EN ORIGEN POR PAÍS</span><span class="tog" id="addC">+ PAÍS</span></h2>
      <div class="whg">${Object.keys(W).sort().map(c => `<label><span>${UI.esc(c)}</span><input data-w="${UI.esc(c)}" inputmode="decimal" value="${UI.fnum(W[c], W[c] % 1 ? 3 : 0).replace(/,?0+$/, m => m.includes(',') ? '' : m)}"><em>%</em></label>`).join('')}</div>
      <div class="whg" style="margin-top:6px"><label><span>DEDUCIBLE EN ESPAÑA (TOPE)</span><input id="dmax" inputmode="decimal" value="${UI.fnum(st.deductibleMax != null ? st.deductibleMax : 15, 0)}"><em>%</em></label></div>

      <h2><span>REGLAS DE LA CARTERA</span></h2>
      <div class="whg">
        <label><span>MÁX. POR EMPRESA</span><input data-r="maxPerCompany" inputmode="decimal" value="${UI.fnum(R.maxPerCompany, R.maxPerCompany % 1 ? 1 : 0)}"><em>%</em></label>
        <label><span>MÁX. mREIT / ALTO RENDIM.</span><input data-r="maxHighYield" inputmode="decimal" value="${UI.fnum(R.maxHighYield, R.maxHighYield % 1 ? 1 : 0)}"><em>%</em></label>
        <label><span>MÁX. CRIPTO</span><input data-r="maxCrypto" inputmode="decimal" value="${UI.fnum(R.maxCrypto, R.maxCrypto % 1 ? 1 : 0)}"><em>%</em></label>
      </div>

      <h2><span>SINCRONIZACIÓN</span></h2>
      <div class="kv" style="margin-top:10px">
        <div class="k">ESTADO</div><div class="v">${S.status() === 'ok' ? '<span class="up">AL DÍA</span>' : S.status() === 'offline' ? '<span class="yellow">SIN CONEXIÓN</span>' : UI.esc(S.status().toUpperCase())}${S.pending() ? ' · ' + S.pending() + ' por subir' : ''}</div>
        <div class="k">ÚLTIMA SINCRONIZACIÓN</div><div class="v">${S.lastSync() ? new Date(S.lastSync()).toLocaleString('es-ES', { timeZone: 'Europe/Madrid', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—'}</div>
        <div class="k">EMPRESAS / OPERACIONES / DIVIDENDOS</div><div class="v">${n.a} / ${n.t} / ${n.d}</div>
        <div class="k">PRECIOS</div><div class="v">${M.lastQuotes() ? new Date(M.lastQuotes()).toLocaleString('es-ES', { timeZone: 'Europe/Madrid', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—'}</div>
        <div class="k">TIPOS BCE</div><div class="v">${M.fxDate() ? UI.fdate(M.fxDate()) : '—'}</div>
      </div>
      <button class="block" id="logout" style="margin-top:18px">CERRAR SESIÓN EN ESTE MÓVIL</button>
      <div class="muted" style="font-size:11px;margin:14px 0 4px">Cartera Carlos · datos en la nube (Supabase) · precios Yahoo Finance / CoinGecko · divisas BCE.</div>`);

    $('#xExcel').onclick = exportExcel;
    $('#xOps').onclick = () => exportCsv('operaciones');
    $('#xDivs').onclick = () => exportCsv('dividendos');
    $('#xJson').onclick = exportJson;
    $('#xImp').onclick = () => $('#impFile').click();
    $('#impFile').onchange = e => importJson(e.target.files[0]);
    $('#addB').onclick = () => openBroker(null);
    document.querySelectorAll('[data-b]').forEach(el => el.onclick = () => openBroker(S.get(el.dataset.b)));
    document.querySelectorAll('[data-w]').forEach(inp => inp.onchange = () => {
      const v = pnum(inp.value);
      if (!(v >= 0 && v <= 100)) return UI.toast('Porcentaje entre 0 y 100');
      saveSettings({ withholding: Object.assign({}, W, { [inp.dataset.w]: v }) }); UI.toast('RETENCIÓN GUARDADA');
    });
    $('#dmax').onchange = e => { const v = pnum(e.target.value); if (v >= 0 && v <= 100) { saveSettings({ deductibleMax: v }); UI.toast('GUARDADO'); } };
    document.querySelectorAll('[data-r]').forEach(inp => inp.onchange = () => {
      const v = pnum(inp.value);
      if (!(v > 0 && v <= 100)) return UI.toast('Porcentaje entre 0 y 100');
      saveSettings({ rules: Object.assign({}, R, { [inp.dataset.r]: v }) }); UI.toast('REGLA GUARDADA');
    });
    $('#addC').onclick = () => {
      const bg = UI.sheet(`<div class="hd"><div class="t">+ PAÍS</div><button data-close>✕</button></div>
        <form class="f" onsubmit="return false"><div class="grid2">
          <div class="fld"><label>PAÍS</label><input id="cn" placeholder="P. EJ. Noruega"></div>
          <div class="fld"><label>RETENCIÓN %</label><input id="cp" inputmode="decimal" placeholder="15"></div></div>
          <div class="muted" style="font-size:11.5px;margin-top:8px">Escríbelo igual que en la ficha de la empresa (campo PAÍS).</div>
          <div class="actions"><button type="button" id="csave" class="primary">GUARDAR</button></div></form>`);
      $('#csave', bg).onclick = () => {
        const c = $('#cn', bg).value.trim(), v = pnum($('#cp', bg).value);
        if (!c || !(v >= 0 && v <= 100)) return UI.toast('Pon país y porcentaje');
        saveSettings({ withholding: Object.assign({}, W, { [c]: v }) }); bg.remove(); UI.render();
      };
    };
    $('#logout').onclick = () => { if (S.pending()) { UI.toast('Hay cambios sin subir: conéctate primero'); return; } S.logout(); UI.render(); };
  }

  window.SettingsScreen = { render, exportExcel, tables };
})();
