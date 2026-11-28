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
    // Dentro de la app de Android: se guarda en la carpeta Descargas.
    if (window.AndroidBridge && window.AndroidBridge.saveFile) {
      const bytes = new Uint8Array(await blob.arrayBuffer());
      let bin = '';
      for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
      window.AndroidBridge.saveFile(filename, blob.type || 'application/octet-stream', btoa(bin));
      markBackup();
      return;
    }
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
  const autoOn = () => { try { return localStorage.getItem('cartera.autoBackup') === '1'; } catch (e) { return false; } };
  // Copia automática (solo en la app de Android y si la activaste): una por semana al abrir la app.
  function autoBackup() {
    if (!window.AndroidBridge || !autoOn() || !S.loggedIn() || !S.list('asset').length) return;
    if (Date.now() - lastBackup() < 7 * 864e5) return;
    exportJson();
  }

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
        const bg = U().sheet(`<div class="hd"><div class="t">RESTAURAR COPIA</div><button data-close aria-label="Cerrar">✕</button></div>
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
    const bg = UI.sheet(`<div class="hd"><div class="t">${b ? 'EDITAR BROKER' : '+ BROKER'}</div><button data-close aria-label="Cerrar">✕</button></div>
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
    const dt = (ts, withYear) => new Date(ts).toLocaleString('es-ES', Object.assign({ timeZone: 'Europe/Madrid', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }, withYear ? { year: 'numeric' } : {}));
    const pct = v => UI.fnum(v, v % 1 ? 3 : 0).replace(/(,\d*?)0+$/, '$1').replace(/,$/, '');
    const rule = (key, label, v) => `<label><span>${label}</span><input data-r="${key}" inputmode="decimal" value="${pct(v)}"><em>%</em></label>`;
    const status = S.status() === 'ok' ? '<span class="up">AL DÍA</span>' : S.status() === 'offline' ? '<span class="yellow">SIN CONEXIÓN</span>' : UI.esc(S.status().toUpperCase());
    const blocks = {
      apariencia: `<h2><span>TEMA</span></h2>
        <div class="seg">${[['dark', 'OSCURO'], ['light', 'CLARO'], ['auto', 'AUTOMÁTICO']].map(o => `<button data-th="${o[0]}" class="${UI.theme.get() === o[0] ? 'on' : ''}">${o[1]}</button>`).join('')}</div>
        <div class="muted" style="font-size:11px;margin:6px 0 4px">Automático sigue el modo claro/oscuro de tu móvil.</div>
        <h2><span>TAMAÑO DE LETRA</span></h2>
        <div class="seg">${[['normal', 'NORMAL'], ['big', 'GRANDE']].map(o => `<button data-fs="${o[0]}" class="${UI.theme.fs() === o[0] ? 'on' : ''}">${o[1]}</button>`).join('')}</div>`,
      telegram: `<h2><span>RESUMEN POR TELEGRAM</span></h2>
        <div class="muted" style="font-size:12px;margin:8px 0">Te manda a tu Telegram un resumen con el patrimonio, lo de hoy, la renta prevista, los próximos cobros y los límites que superas. Lo calcula la app con los precios que tiene ahora, así que ábrela y deja que carguen antes de enviarlo.</div>
        <div class="bk"><button id="tgBtn" class="primary">✈ ENVIAR RESUMEN AHORA</button></div>`,
      app: `      <h2><span>LA APP</span><span class="${UI.hasUpdate() ? 'cyan' : 'muted'}">${UI.hasUpdate() ? 'HAY VERSIÓN NUEVA' : 'AL DÍA'}</span></h2>
      <div class="kv" style="margin-top:10px">
        <div class="k">INSTALADA</div><div class="v">${UI.esc(window.APP_VERSION || '—')}</div>
        <div class="k">ÚLTIMA</div><div class="v ${UI.hasUpdate() ? 'cyan' : ''}">${UI.upd.error ? '<span class="yellow">SIN CONEXIÓN</span>' : UI.upd.latest ? UI.esc(UI.upd.latest) : '—'}</div>
      </div>
      <div class="bk" style="margin-top:10px"><button id="updBtn" class="${UI.hasUpdate() ? 'primary' : ''}">${UI.hasUpdate() ? '⬇ ACTUALIZAR LA APP AHORA' : '↻ BUSCAR ACTUALIZACIÓN'}</button></div>
`,
      copia: `
      <h2><span>COPIA DE SEGURIDAD</span><span class="${old ? 'yellow' : 'muted'}">${lb ? 'ÚLTIMA ' + UI.fdate(new Date(lb).toLocaleDateString('sv-SE')) : 'NUNCA'}</span></h2>
      ${old ? '<div class="warn">Haz una copia de vez en cuando (por ejemplo, una al mes) y guárdala en Drive o mándatela por email.</div>' : ''}
      <div class="bk">
        <button id="xExcel" class="primary">⬇ EXCEL COMPLETO (.xlsx)</button>
        <div class="bk2"><button id="xOps">CSV OPERACIONES</button><button id="xDivs">CSV DIVIDENDOS</button></div>
        <div class="bk2"><button id="xJson">COPIA PARA RESTAURAR</button><button id="xImp">RESTAURAR COPIA</button></div>
        <input type="file" id="impFile" accept=".json,application/json" hidden>
      </div>
      ${window.AndroidBridge ? `<div class="bk" style="margin-top:10px"><button id="autoBk" class="${autoOn() ? 'primary' : ''}">${autoOn() ? '✓ COPIA AUTOMÁTICA SEMANAL ACTIVADA' : 'ACTIVAR COPIA AUTOMÁTICA SEMANAL'}</button></div>
      <div class="muted" style="font-size:11px;margin-top:6px">Cada semana, al abrir la app, guarda una copia para restaurar en la carpeta Descargas. Es un archivo con tus datos: no lo compartas.</div>` : ''}
`,
      brokers: `
      <h2><span>BROKERS</span><span class="tog" id="addB">+ AÑADIR</span></h2>
      <div class="rows">${brokers.map(b => `<div class="row" data-b="${UI.esc(b.id)}"><div class="mid"><div class="tk">${UI.esc(b.name)}</div>
        <div class="nm">${b.feePct ? pct(b.feePct) + '% del importe' : 'última comisión usada · por defecto ' + UI.eur(b.feeFixed || 0)}</div></div>
        <div class="rt muted">EDITAR ›</div></div>`).join('')}</div>
`,
      ret: `
      <h2><span>RETENCIÓN EN ORIGEN</span><span class="tog" id="addC">+ PAÍS</span></h2>
      <div class="whg">${Object.keys(W).sort().map(c => `<label><span>${UI.esc(c)}</span><input data-w="${UI.esc(c)}" inputmode="decimal" value="${pct(W[c])}"><em>%</em></label>`).join('')}</div>
      <div class="whg one"><label><span>TOPE DEDUCIBLE EN ESPAÑA</span><input id="dmax" inputmode="decimal" value="${pct(st.deductibleMax != null ? st.deductibleMax : 15)}"><em>%</em></label></div>
`,
      reglas: `
      <h2><span>REGLAS DE LA CARTERA</span></h2>
      <div class="whg one">
        ${rule('maxPerCompany', 'MÁX. POR EMPRESA', R.maxPerCompany)}
        ${rule('maxHighYield', 'MÁX. mREIT / ALTO RENDIMIENTO', R.maxHighYield)}
        ${rule('maxCrypto', 'MÁX. CRIPTO', R.maxCrypto)}
      </div>
      <h2><span>OBJETIVO DE RENTA</span></h2>
      <div class="whg one"><label><span>RENTA NETA ANUAL QUE QUIERES</span><input id="goal" inputmode="decimal" value="${st.incomeGoal ? pct(st.incomeGoal) : ''}" placeholder="p. ej. 3000"><em>€</em></label></div>
      <div class="muted" style="font-size:11px;margin-top:6px">Se muestra en Inicio con una barra de progreso frente a tu renta prevista.</div>
`,
      avisos: `
      ${window.AndroidBridge ? `<h2><span>AVISOS Y WIDGET</span><span class="${window.AndroidBridge.notificationsEnabled() ? 'up' : 'muted'}">${window.AndroidBridge.notificationsEnabled() ? 'AVISOS ACTIVOS' : 'AVISOS DESACTIVADOS'}</span></h2>
      <div class="bk" style="margin-top:10px">${window.AndroidBridge.notificationsEnabled() ? '' : '<button id="ntfBtn" class="primary">🔔 ACTIVAR AVISOS DE DIVIDENDOS</button>'}</div>
      <div class="muted" style="font-size:11px;margin-top:6px">Te aviso el día antes y el mismo día de cada pago, ex-dividendo y resultados de tus empresas. <b>Widget:</b> mantén pulsada la pantalla de inicio → Widgets → Cartera Carlos.</div>
      ` : ''}`,
      seg: `
      <h2><span>SEGURIDAD</span><span class="${UI.pin.get() ? 'up' : 'muted'}">${UI.pin.get() ? 'PIN ACTIVO' : 'SIN PIN'}</span></h2>
      <div class="bk" style="margin-top:10px">${UI.pin.get()
        ? `<div class="bk2"><button id="pinChg">CAMBIAR PIN</button><button id="pinDel" class="out">QUITAR PIN</button></div>
           <button id="bioBtn">${UI.bio.get() ? '✓ HUELLA ACTIVA · QUITAR' : '👆 ACTIVAR HUELLA / FACE ID'}</button>`
        : '<button id="pinSet">🔒 PONER PIN PARA ABRIR LA APP</button>'}</div>
      <div class="bk" style="margin-top:10px"><button id="roOn">👁 ACTIVAR MODO LECTURA</button></div>
      <div class="muted" style="font-size:11px;margin-top:6px">Modo lectura: oculta los importes y bloquea cualquier cambio, para enseñar la cartera. Para salir pide tu PIN (si tienes). · Pide el PIN al abrir la app y tras 2 minutos fuera de ella. Solo protege este móvil: tus datos siguen en la nube.</div>
`,
      sync: `
      <h2><span>SINCRONIZACIÓN</span></h2>
      <div class="kv" style="margin-top:10px">
        <div class="k">ESTADO</div><div class="v">${status}${S.pending() ? ' · ' + S.pending() + ' POR SUBIR' : ''}</div>
        <div class="k">ÚLTIMA VEZ</div><div class="v">${S.lastSync() ? dt(S.lastSync(), true) : '—'}</div>
        <div class="k">EMPRESAS</div><div class="v">${n.a}</div>
        <div class="k">OPERACIONES</div><div class="v">${n.t}</div>
        <div class="k">DIVIDENDOS</div><div class="v">${n.d}</div>
        <div class="k">PRECIOS</div><div class="v">${M.lastQuotes() ? dt(M.lastQuotes()) : '—'}</div>
        <div class="k">TIPOS BCE</div><div class="v">${M.fxDate() ? UI.fdate(M.fxDate()) : '—'}</div>
      </div>`
    };
    const IC = {
      brokers: '<path d="M3 10l9-6 9 6M5 10v8M19 10v8M9 10v8M15 10v8M3 20h18"/>',
      ret: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18"/>',
      reglas: '<path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"/><path d="M9 12l2 2 4-4"/>',
      copia: '<path d="M12 3v12M7 10l5 5 5-5M4 20h16"/>',
      sync: '<path d="M20 12a8 8 0 0 1-14 5.3M4 12a8 8 0 0 1 14-5.3M18 3v4h-4M6 21v-4h4"/>',
      avisos: '<path d="M6 16V11a6 6 0 0 1 12 0v5l2 2H4zM10 21h4"/>',
      seg: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
      apariencia: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
      telegram: '<path d="M21 4L3 11l6 2 2 6 3-4 5 3z"/><path d="M9 13l12-9"/>',
      app: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/>'
    };
    const item = (k, title, summary) => `<div class="sitem" data-sub="${k}"><span class="sic"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${IC[k]}</svg></span><span class="stx"><b>${title}</b><em>${summary}</em></span><span class="sch">›</span></div>`;
    const grp = t => `<h2><span>${t}</span></h2>`;
    const menu = grp('CARTERA')
      + item('brokers', 'Brokers y comisiones', brokers.length + ' brokers')
      + item('ret', 'Retención por país', Object.keys(W).length + ' países · tope ' + pct(st.deductibleMax != null ? st.deductibleMax : 15) + ' %')
      + item('reglas', 'Reglas y objetivo', 'máx. ' + pct(R.maxPerCompany) + ' % por empresa' + (st.incomeGoal ? ' · objetivo ' + UI.eur(st.incomeGoal, 0) : ''))
      + grp('DATOS')
      + item('copia', 'Copia de seguridad', lb ? 'última ' + UI.fdate(new Date(lb).toLocaleDateString('sv-SE')) : 'nunca hecha')
      + item('sync', 'Sincronización', S.status() === 'ok' ? 'al día' : S.status() === 'offline' ? 'sin conexión' : S.status())
      + grp('SISTEMA')
      + item('apariencia', 'Apariencia', ({ dark: 'oscuro', light: 'claro', auto: 'automático' })[UI.theme.get()] + (UI.theme.fs() === 'big' ? ' · letra grande' : ''))
      + item('seg', 'Seguridad', UI.pin.get() ? 'PIN activo' + (UI.bio.get() ? ' · huella' : '') : 'sin PIN')
      + (window.AndroidBridge ? item('avisos', 'Avisos y widget', window.AndroidBridge.notificationsEnabled() ? 'avisos activos' : 'avisos desactivados') : '')
      + item('telegram', 'Resumen por Telegram', 'enviar resumen ahora')
      + item('app', 'La app', (window.APP_VERSION || '—') + (UI.hasUpdate() ? ' · hay versión nueva' : ''))
      + '<div class="foot">Cartera Carlos · datos en la nube (Supabase) · precios Yahoo Finance y CoinGecko · divisas BCE</div>';
    const SUBT = { brokers: 'BROKERS', ret: 'RETENCIÓN', reglas: 'REGLAS', copia: 'COPIA', sync: 'SYNC', seg: 'SEGURIDAD', avisos: 'AVISOS', app: 'LA APP' };
    const sub = UI.ui.sub && blocks[UI.ui.sub] ? UI.ui.sub : null;
    UI.shell(sub
      ? `<div class="subhd"><button id="subBack">‹ AJUSTES</button></div>` + blocks[sub] + (sub === 'sync' ? `<button class="block out" id="logout">CERRAR SESIÓN EN ESTE MÓVIL</button>` : '')
      : menu);
    const Q = sel => $(sel) || {};
    document.querySelectorAll('[data-sub]').forEach(el => el.onclick = () => UI.navigate({ sub: el.dataset.sub }));
    document.querySelectorAll('[data-th]').forEach(b => b.onclick = () => { UI.theme.set(b.dataset.th); UI.render(); });
    document.querySelectorAll('[data-fs]').forEach(b => b.onclick = () => { UI.theme.setFs(b.dataset.fs); UI.render(); });
    Q('#tgBtn').onclick = async () => {
      const b = Q('#tgBtn'); b.textContent = 'ENVIANDO…'; b.disabled = true;
      let r; try { r = await UI.sendDigest(); } catch (e) { r = { error: 'offline' }; }
      b.disabled = false; b.textContent = '✈ ENVIAR RESUMEN AHORA';
      UI.toast(r.ok ? 'RESUMEN ENVIADO A TELEGRAM' : r.error === 'missing_telegram' ? 'Telegram no está configurado en la nube' : r.error === 'empty' ? 'No hay datos que enviar' : 'No se pudo enviar: ' + r.error);
    };
    Q('#roOn').onclick = () => UI.setReadonly(true);
    Q('#subBack').onclick = () => UI.goBack();
    Q('#updBtn').onclick = async () => {
      if (UI.hasUpdate()) return UI.applyUpdate();
      (Q('#updBtn')).textContent = 'BUSCANDO…';
      await UI.checkUpdate(true);
      if (UI.hasUpdate()) { UI.render(); UI.toast('HAY UNA VERSIÓN NUEVA'); }
      else if (UI.upd.error) { UI.toast('No se pudo comprobar: sin conexión'); (Q('#updBtn')).textContent = '↻ BUSCAR ACTUALIZACIÓN'; }
      else { UI.toast('YA TIENES LA ÚLTIMA VERSIÓN'); (Q('#updBtn')).textContent = '↻ BUSCAR ACTUALIZACIÓN'; }
    };
    // ---------- PIN ----------
    const askPin = (title, hint) => new Promise(resolve => {
      const bg = UI.sheet(`<div class="hd"><div class="t">${UI.esc(title)}</div><button data-close aria-label="Cerrar">✕</button></div>
        <form class="f" onsubmit="return false"><div class="fld"><label>${UI.esc(hint)}</label>
        <input id="pinIn" type="password" inputmode="numeric" autocomplete="off" maxlength="6" placeholder="••••"></div>
        <div class="actions"><button type="button" id="pinOk" class="primary">ACEPTAR</button></div></form>`);
      const inp = $('#pinIn', bg);
      const done = v => { bg.remove(); resolve(v); };
      setTimeout(() => inp.focus(), 60);
      $('#pinOk', bg).onclick = () => { const v = inp.value.trim(); if (!/^\d{4,6}$/.test(v)) return UI.toast('PIN: entre 4 y 6 dígitos'); done(v); };
      inp.onkeydown = e => { if (e.key === 'Enter') $('#pinOk', bg).click(); };
      bg.addEventListener('click', e => { if (e.target === bg || e.target.closest('[data-close]')) done(null); });
    });
    const setPin = async () => {
      const a = await askPin('PONER PIN', 'PIN NUEVO (4 A 6 DÍGITOS)'); if (!a) return;
      const b = await askPin('CONFIRMA EL PIN', 'REPÍTELO'); if (!b) return;
      if (a !== b) return UI.toast('LOS PIN NO COINCIDEN');
      UI.pin.save(await UI.pin.make(a)); UI.toast('PIN ACTIVADO'); UI.render();
    };
    const pinSet = Q('#pinSet'); if (pinSet) pinSet.onclick = setPin;
    const pinChg = Q('#pinChg'); if (pinChg) pinChg.onclick = async () => {
      const cur = await askPin('PIN ACTUAL', 'PIN ACTUAL'); if (!cur) return;
      if (!(await UI.pin.check(cur, UI.pin.get()))) return UI.toast('PIN INCORRECTO');
      await setPin();
    };
    const bioBtn = Q('#bioBtn'); if (bioBtn) bioBtn.onclick = async () => {
      if (UI.bio.get()) { UI.bio.save(null); UI.toast('HUELLA QUITADA'); return UI.render(); }
      if (!(await UI.bio.available())) return UI.toast('Este móvil no ofrece huella para el navegador');
      const cur = await askPin('CONFIRMA CON TU PIN', 'PIN ACTUAL'); if (!cur) return;
      if (!(await UI.pin.check(cur, UI.pin.get()))) return UI.toast('PIN INCORRECTO');
      try { UI.bio.save({ id: await UI.bio.enroll() }); UI.toast('HUELLA ACTIVADA'); UI.render(); }
      catch (e) { UI.toast('No se pudo activar la huella'); }
    };
    const pinDel = Q('#pinDel'); if (pinDel) pinDel.onclick = async () => {
      const cur = await askPin('QUITAR PIN', 'PIN ACTUAL'); if (!cur) return;
      if (!(await UI.pin.check(cur, UI.pin.get()))) return UI.toast('PIN INCORRECTO');
      UI.pin.save(null); UI.toast('PIN QUITADO'); UI.render();
    };
    const ntfBtn = Q('#ntfBtn'); if (ntfBtn) ntfBtn.onclick = () => window.AndroidBridge.requestNotifications();
    Q('#xExcel').onclick = exportExcel;
    Q('#xOps').onclick = () => exportCsv('operaciones');
    Q('#xDivs').onclick = () => exportCsv('dividendos');
    Q('#xJson').onclick = exportJson;
    const ab = Q('#autoBk'); if (ab) ab.onclick = () => { try { localStorage.setItem('cartera.autoBackup', autoOn() ? '0' : '1'); } catch (e) { /* sin almacenamiento */ } if (autoOn()) autoBackup(); U().render(); };
    Q('#xImp').onclick = () => Q('#impFile').click();
    Q('#impFile').onchange = e => importJson(e.target.files[0]);
    Q('#addB').onclick = () => openBroker(null);
    document.querySelectorAll('[data-b]').forEach(el => el.onclick = () => openBroker(S.get(el.dataset.b)));
    document.querySelectorAll('[data-w]').forEach(inp => inp.onchange = () => {
      const v = pnum(inp.value);
      if (!(v >= 0 && v <= 100)) return UI.toast('Porcentaje entre 0 y 100');
      saveSettings({ withholding: Object.assign({}, W, { [inp.dataset.w]: v }) }); UI.toast('RETENCIÓN GUARDADA');
    });
    Q('#dmax').onchange = e => { const v = pnum(e.target.value); if (v >= 0 && v <= 100) { saveSettings({ deductibleMax: v }); UI.toast('GUARDADO'); } };
    document.querySelectorAll('[data-r]').forEach(inp => inp.onchange = () => {
      const v = pnum(inp.value);
      if (!(v > 0 && v <= 100)) return UI.toast('Porcentaje entre 0 y 100');
      saveSettings({ rules: Object.assign({}, R, { [inp.dataset.r]: v }) }); UI.toast('REGLA GUARDADA');
    });
    Q('#goal').onchange = e => { const v = pnum(e.target.value); if (e.target.value.trim() === '') { saveSettings({ incomeGoal: 0 }); UI.toast('OBJETIVO QUITADO'); } else if (v > 0) { saveSettings({ incomeGoal: v }); UI.toast('OBJETIVO GUARDADO'); } };
    Q('#addC').onclick = () => {
      const bg = UI.sheet(`<div class="hd"><div class="t">+ PAÍS</div><button data-close aria-label="Cerrar">✕</button></div>
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
    Q('#logout').onclick = () => { if (S.pending()) { UI.toast('Hay cambios sin subir: conéctate primero'); return; } UI.pin.save(null); S.logout(); UI.render(); };
  }

  window.SettingsScreen = { render, exportExcel, tables, autoBackup };
})();
