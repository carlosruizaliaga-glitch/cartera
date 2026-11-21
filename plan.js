// PLAN (dentro de Análisis): objetivos y proyección, simulador "qué pasa si" y salud de tus dividendos. Además genera las ALERTAS de Inicio.
(function () {
  'use strict';
  const S = window.Store, M = window.Market, C = window.Calc;
  const U = () => window.UI;
  const LS = 'cartera.plan.v1';
  const saved = (() => { try { return JSON.parse(localStorage.getItem(LS) || '{}'); } catch (e) { return {}; } })();
  const st = { health: saved.health || {}, healthAt: saved.healthAt || 0, running: false, err: null, simPos: null, simPct: 50, dg: saved.dg != null ? saved.dg : 4, pg: saved.pg != null ? saved.pg : 0 };
  const persist = () => { try { localStorage.setItem(LS, JSON.stringify({ health: st.health, healthAt: st.healthAt, dg: st.dg, pg: st.pg })); } catch (e) { /* sin almacenamiento */ } };
  const settings = () => S.get('settings') || {};
  const esc = s => U().esc(s);
  const card = (title, sub, inner) => `<h2><span>${title}</span></h2>${sub ? `<div class="muted" style="font-size:11.5px;margin:-2px 2px 8px">${sub}</div>` : ''}${inner}`;
  const num = v => window.Forms.parseNum(v);

  // ---------- Objetivos y proyección ----------
  function monthlyDefault() {
    const t = U().today(), from = C.addDays(t, -365);
    const net = S.list('tx').filter(x => x.date >= from && (x.type === 'buy' || x.type === 'sell'))
      .reduce((s, x) => s + (x.type === 'buy' ? 1 : -1) * (x.qty * x.price / (x.fx || 1)), 0);
    return Math.max(0, Math.round(net / 12 / 10) * 10);
  }
  function project(mdl, rows) {
    const UI = U(), st0 = settings();
    const stocks = rows.filter(r => r.a.type !== 'crypto');
    const fc = window.Divs ? window.Divs.forecast(stocks) : null;
    const total = rows.reduce((s, r) => s + (r.value || 0), 0), vStocks = stocks.reduce((s, r) => s + (r.value || 0), 0);
    const monthly = st0.monthlyContribution != null ? st0.monthlyContribution : monthlyDefault();
    const goalI = st0.incomeGoal || 0, goalW = st0.wealthGoal || 0;
    const netYield = fc && vStocks ? fc.net / vStocks : 0.03;
    const pts = []; let W = total, i0 = fc ? fc.net : 0;
    // simulación mensual: aportación + dividendos reinvertidos + revalorización; el yield efectivo sube con el crecimiento del dividendo
    let yearHitI = null, yearHitW = null;
    for (let m = 0; m <= 12 * 25; m++) {
      const yr = m / 12, y = netYield * Math.pow(1 + st.dg / 100, yr);
      const income = Math.min(W, W * (vStocks / (total || 1))) * y;
      if (m % 12 === 0) pts.push({ yr, W, income });
      if (yearHitI == null && goalI && income >= goalI) yearHitI = yr;
      if (yearHitW == null && goalW && W >= goalW) yearHitW = yr;
      W = W * (1 + st.pg / 100 / 12) + monthly + income / 12;
    }
    return { pts, monthly, goalI, goalW, yearHitI, yearHitW, netYield, total, i0 };
  }
  function projectionHtml(mdl, rows) {
    const UI = U(), p = project(mdl, rows);
    const max = Math.max(1, ...p.pts.map(x => x.income), p.goalI || 0), W = 360, H = 150;
    const x = i => i / (p.pts.length - 1) * W, y = v => H - 6 - v / max * (H - 16);
    const path = p.pts.map((q, i) => (i ? 'L' : 'M') + x(i).toFixed(1) + ' ' + y(q.income).toFixed(1)).join('');
    const gl = p.goalI ? `<line x1="0" x2="${W}" y1="${y(p.goalI).toFixed(1)}" y2="${y(p.goalI).toFixed(1)}" stroke="var(--green)" stroke-dasharray="5 5" stroke-width="2" vector-effect="non-scaling-stroke"/>` : '';
    const hits = p.pts.map((q, i) => `<rect data-tip="${esc('Dentro de ' + q.yr + ' años|Renta ' + UI.eur(q.income, 0) + '/año|Patrimonio ' + UI.eur(q.W, 0))}" x="${(x(i) - 7).toFixed(1)}" y="0" width="14" height="${H}" fill="transparent"/>`).join('');
    const when = yr => yr == null ? 'no se alcanza en 25 años con estas hipótesis' : yr < 0.1 ? '¡ya lo has alcanzado!' : 'en ~' + (yr < 1 ? 'menos de 1 año' : UI.fnum(yr, 1) + ' años');
    return card('OBJETIVOS', 'Proyección con tus aportaciones y los dividendos reinvertidos. Es una hipótesis, no una promesa.',
      `<div class="gcard"><div class="f"><div class="grid2">
        <div class="fld" style="margin-top:0"><label>OBJETIVO RENTA NETA (€/AÑO)</label><input id="planGI" inputmode="decimal" value="${p.goalI || ''}" placeholder="3000"></div>
        <div class="fld" style="margin-top:0"><label>OBJETIVO PATRIMONIO (€)</label><input id="planGW" inputmode="decimal" value="${p.goalW || ''}" placeholder="50000"></div></div>
        <div class="grid2"><div class="fld"><label>APORTACIÓN MENSUAL (€)</label><input id="planMo" inputmode="decimal" value="${p.monthly}"></div>
        <div class="fld"><label>CRECE EL DIVIDENDO (%/AÑO)</label><input id="planDG" inputmode="decimal" value="${st.dg}"></div></div>
        <div class="fld"><label>REVALORIZACIÓN DE PRECIOS (%/AÑO)</label><input id="planPG" inputmode="decimal" value="${st.pg}"></div></div></div>
      <div class="gcard"><svg viewBox="0 0 ${W} ${H + 18}" class="gsvg" preserveAspectRatio="none">${gl}<path d="${path}" fill="none" stroke="var(--yellow)" stroke-width="2.4" vector-effect="non-scaling-stroke" stroke-linejoin="round"/>${hits}</svg>
        <div class="gl"><span><i style="background:var(--yellow)"></i>RENTA NETA ANUAL</span>${p.goalI ? '<span><i style="background:var(--green)"></i>OBJETIVO</span>' : ''}</div>
        <div class="muted" style="font-size:12px;margin-top:8px">${p.goalI ? `Renta de ${UI.eur(p.goalI, 0)}/año: <b style="color:var(--fg)">${when(p.yearHitI)}</b>.<br>` : ''}${p.goalW ? `Patrimonio de ${UI.eur(p.goalW, 0)}: <b style="color:var(--fg)">${when(p.yearHitW)}</b>.<br>` : ''}${!p.goalI && !p.goalW ? 'Pon un objetivo arriba para ver cuándo lo alcanzas.<br>' : ''}Parte de ${UI.eur(p.total, 0)} y una renta de ${UI.eur(p.i0, 0)}/año (yield neto ${UI.fnum(p.netYield * 100, 1)}%).</div></div>`);
  }

  // ---------- Simulador "qué pasa si" ----------
  function simHtml(rows) {
    const UI = U();
    const total = rows.reduce((s, r) => s + (r.value || 0), 0);
    const sel = rows.find(r => r.a.id === st.simPos) || rows[0];
    if (!sel) return '';
    const pct = st.simPct, qty = sel.p.qty * pct / 100, proceeds = (sel.value || 0) * pct / 100;
    const sim = C.simulateSale(S.list('tx').filter(t => t.asset === sel.a.id), sel.a.id, qty, proceeds);
    const fc = window.Divs ? window.Divs.forecast(rows.filter(r => r.a.type !== 'crypto')) : null;
    const perRow = fc && fc.by.find(b => b.a.id === sel.a.id);
    const lost = perRow ? perRow.net * pct / 100 : 0;
    const R = Object.assign({ maxPerCompany: 7 }, settings().rules || {});
    const wBefore = total ? sel.value / total * 100 : 0, wAfter = total ? (sel.value - proceeds) / (total - proceeds || 1) * 100 : 0;
    const tax = b => [[6000, .19], [44000, .21], [150000, .23], [100000, .26], [Infinity, .28]].reduce((o, [w, r]) => { const x = Math.min(Math.max(b - o.d, 0), w); return { t: o.t + x * r, d: o.d + w }; }, { t: 0, d: 0 }).t;
    const yr = U().today().slice(0, 4), base = Object.values(UI.model().pos).reduce((s, p) => s + ((p.realized && p.realized[yr]) || 0), 0);
    const taxAdd = sim && sim.pl > 0 ? tax(Math.max(0, base + sim.pl)) - tax(Math.max(0, base)) : 0;
    return card('SIMULADOR · ¿Y SI VENDO?', 'Prueba una venta sin registrarla: mira cuánto renta pierdes y cómo queda el peso.',
      `<div class="gcard"><div class="f"><div class="fld" style="margin-top:0"><label>POSICIÓN</label><select id="simPos" class="sugin" style="width:100%">${rows.map(r => `<option value="${esc(r.a.id)}" ${r.a.id === sel.a.id ? 'selected' : ''}>${esc(r.a.ticker)} · ${esc(r.a.name)}</option>`).join('')}</select></div>
        <div class="fld"><label>VENDER ${pct}% (${UI.qtyFmt(qty)} acc.)</label><input id="simPct" type="range" min="5" max="100" step="5" value="${pct}" style="width:100%"></div></div>
        <div class="kv" style="margin-top:10px"><div class="k">RECIBES</div><div class="v">${UI.eur(proceeds, 0)}</div>
        <div class="k">PLUSVALÍA</div><div class="v ${UI.cls(sim ? sim.pl : 0)}">${sim ? UI.sEur(sim.pl, 0) : '—'}</div>
        ${taxAdd ? `<div class="k">IMPUESTO APROX.</div><div class="v yellow">~${UI.eur(taxAdd, 0)}</div>` : ''}
        <div class="k">RENTA QUE PIERDES</div><div class="v ${lost ? 'down' : ''}">${lost ? '−' + UI.eur(lost, 0) + '/año' : '—'}</div>
        <div class="k">PESO EN CARTERA</div><div class="v">${UI.fnum(wBefore, 1)}% → ${UI.fnum(wAfter, 1)}% <span class="${wAfter > R.maxPerCompany ? 'down' : 'up'}">(máx. ${UI.fnum(R.maxPerCompany, 0)}%)</span></div></div></div>`);
  }

  // ---------- Salud de tus dividendos ----------
  const flags = c => {
    const out = [], payout = c.payout != null ? c.payout : c.fcfPayout, fin = c.sector === 'Financial Services', re = c.sector === 'Real Estate';
    if (c.cuts > 0) out.push('ha recortado el dividendo antes');
    if (!re && payout != null && payout > 0.85) out.push('payout ' + Math.round(payout * 100) + '% (poco margen)');
    if (c.earningsGrowth != null && c.earningsGrowth < -0.25) out.push('beneficios cayendo ' + Math.round(c.earningsGrowth * 100) + '%');
    if (!fin && c.netDebtEbitda != null && c.netDebtEbitda > 4) out.push('deuda ' + c.netDebtEbitda.toFixed(1) + '× EBITDA');
    if (c.margin != null && c.margin <= 0) out.push('pierde dinero');
    return out;
  };
  function healthHtml(rows) {
    const UI = U();
    const held = rows.filter(r => r.a.type !== 'crypto' && r.a.yahoo);
    const have = held.filter(r => st.health[r.a.yahoo]);
    const body = have.map(r => ({ r, c: st.health[r.a.yahoo], f: flags(st.health[r.a.yahoo]) })).sort((a, b) => b.f.length - a.f.length).map(({ r, c, f }) =>
      `<div class="grow"><b>${esc(r.a.ticker)}</b><span class="mu">${f.length ? esc(f.join(' · ')) : 'sin señales de alarma'}</span><em class="${f.length >= 2 ? 'down' : f.length ? 'yellow' : 'up'}">${f.length >= 2 ? 'RIESGO' : f.length ? 'VIGILAR' : 'OK'}</em></div>`).join('');
    return card('SALUD DE TUS DIVIDENDOS', 'Revisa si alguna de tus empresas da señales de poder recortar el dividendo (payout alto, beneficios a la baja, deuda).',
      `<div class="gcard"><div class="bk"><button id="planHealth" class="primary" ${st.running ? 'disabled' : ''}>${st.running ? 'REVISANDO…' : st.healthAt ? '↻ REVISAR DE NUEVO' : '🩺 REVISAR MIS EMPRESAS'}</button></div>
      <div class="muted" style="font-size:11px;margin-top:8px">${st.healthAt ? 'Revisado hace ' + Math.max(1, Math.round((Date.now() - st.healthAt) / 3600000)) + ' h · ' + have.length + ' de ' + held.length + ' empresas.' : 'Aún no revisado.'}${st.err ? `<br><span class="down">Error: ${esc(st.err)}</span>` : ''}</div></div>${body ? `<div class="gcard rowsc">${body}</div>` : ''}`);
  }
  async function runHealth(rerender) {
    if (st.running) return;
    const syms = U().model().rows.filter(r => r.a.type !== 'crypto' && r.a.yahoo).map(r => r.a.yahoo);
    st.running = true; st.err = null; rerender();
    try {
      for (let i = 0; i < syms.length; i += 20) {
        const res = await fetch(S.BASE + '/functions/v1/ct-screen', { method: 'POST', headers: { apikey: S.KEY, 'Content-Type': 'application/json' }, body: JSON.stringify({ secret: S.secret(), symbols: syms.slice(i, i + 20), force: true }) });
        const d = await res.json().catch(() => ({}));
        if (!res.ok || d.error) throw new Error(d.error || 'HTTP ' + res.status);
        Object.assign(st.health, d.items || {}); st.healthAt = Date.now(); persist(); rerender();
      }
    } catch (e) { st.err = String(e && e.message || e); }
    st.running = false; persist(); rerender();
  }

  // ---------- Alertas de Inicio ----------
  function alerts(rows, total) {
    const UI = U(), out = [], R = Object.assign({ maxPerCompany: 7, maxHighYield: 5, maxCrypto: 5 }, settings().rules || {});
    rows.filter(r => r.a.type !== 'crypto' && total && r.value / total * 100 > R.maxPerCompany * 1.5).slice(0, 2)
      .forEach(r => out.push({ id: 'peso-' + r.a.ticker, lvl: 'r', txt: `${r.a.ticker} pesa un ${UI.fnum(r.value / total * 100, 1)}% de la cartera, más del doble de tu límite.`, html: `<b>${esc(r.a.ticker)}</b> pesa un ${UI.fnum(r.value / total * 100, 1)}%, más del doble de tu límite razonable (${UI.fnum(R.maxPerCompany, 0)}%).` }));
    const crW = total ? rows.filter(r => r.a.type === 'crypto').reduce((s, r) => s + (r.value || 0), 0) / total * 100 : 0;
    if (crW > R.maxCrypto) out.push({ id: 'cripto', lvl: 'y', txt: `Cripto al ${UI.fnum(crW, 1)}% (tu máximo es ${UI.fnum(R.maxCrypto, 0)}%).`, html: `Cripto al <b>${UI.fnum(crW, 1)}%</b> (tu máximo es ${UI.fnum(R.maxCrypto, 0)}%).` });
    Object.keys(st.health).forEach(sym => {
      const r = rows.find(x => x.a.yahoo === sym); if (!r) return;
      const f = flags(st.health[sym]); if (f.length >= 2) out.push({ id: 'riesgo-' + sym, lvl: 'r', txt: `${r.a.ticker}: riesgo para el dividendo (${f.slice(0, 2).join(', ')}).`, html: `<b>${esc(r.a.ticker)}</b>: riesgo para el dividendo (${esc(f.slice(0, 2).join(', '))}).` });
    });
    try {
      const sug = JSON.parse(localStorage.getItem('cartera.sug.v1') || '{}');
      if (sug.data && window.Suggest && window.Suggest.best) { const b = window.Suggest.best(rows); if (b) out.push({ id: 'op-' + b.c.sym, lvl: 'g', txt: `Oportunidad: ${b.c.sym} puntúa ${b.score}/100 y ayuda a equilibrar tu cartera.`, html: `Oportunidad: <b>${esc(b.c.sym)}</b> (${esc(b.c.name)}) puntúa ${b.score}/100 y ayuda a equilibrar. Mira Análisis → Sugerencias.` }); }
    } catch (e) { /* sin datos */ }
    const pending = S.list('dividend').filter(d => d.status === 'pending').length;
    if (pending) out.push({ lvl: 'y', html: `Tienes <b>${pending}</b> dividendo${pending > 1 ? 's' : ''} pendiente${pending > 1 ? 's' : ''} de confirmar.` });
    try {
      const lb = +localStorage.getItem('cartera.lastBackup') || 0, dias = Math.floor((Date.now() - lb) / 864e5);
      if (S.list('asset').length && (!lb || dias > 30)) out.push({ lvl: 'y', html: lb ? `Hace <b>${dias} días</b> que no haces copia de seguridad. Ajustes → Copia de seguridad.` : `Aún no has hecho <b>ninguna copia de seguridad</b>. Ajustes → Copia de seguridad.` });
    } catch (e) { /* sin almacenamiento */ }
    return out;
  }
  // Alertas nuevas para avisar en el móvil: cada una se manda solo el día en que aparece por primera vez.
  function alertEvents(rows, total) {
    const today = new Date().toLocaleDateString('sv-SE');
    let seen = {};
    try { seen = JSON.parse(localStorage.getItem('cartera.alertsSeen') || '{}'); } catch (e) { seen = {}; }
    const now = alerts(rows, total).filter(a => a.id && a.lvl !== 'y' || (a.id && a.id === 'cripto'));
    const live = {};
    now.forEach(a => { live[a.id] = seen[a.id] || today; });
    try { localStorage.setItem('cartera.alertsSeen', JSON.stringify(live)); } catch (e) { /* sin almacenamiento */ }
    return now.filter(a => live[a.id] === today).map(a => ({ t: a.id, k: 'alert', d: today, x: a.txt }));
  }
  const alertsHtml = (rows, total) => {
    const a = alerts(rows, total);
    return a.length ? `<h2><span>ALERTAS · ${a.length}</span></h2><div class="ins alerts">${a.slice(0, 4).map(x => `<p class="al ${x.lvl}">${x.html}</p>`).join('')}</div>` : '';
  };

  function render(rows) {
    const mdl = U().model();
    return `${projectionHtml(mdl, rows)}${simHtml(rows)}${healthHtml(rows)}`;
  }
  function bind(app, rerender) {
    const setS = patch => S.put('settings', Object.assign({}, settings(), patch));
    const g = (id, fn) => { const e = app.querySelector(id); if (e) e.onchange = () => { fn(num(e.value), e.value); rerender(); }; };
    g('#planGI', (v, raw) => setS({ incomeGoal: raw.trim() === '' ? 0 : v > 0 ? v : 0 }));
    g('#planGW', (v, raw) => setS({ wealthGoal: raw.trim() === '' ? 0 : v > 0 ? v : 0 }));
    g('#planMo', v => setS({ monthlyContribution: v >= 0 ? v : 0 }));
    g('#planDG', v => { st.dg = Math.max(-5, Math.min(20, v || 0)); persist(); });
    g('#planPG', v => { st.pg = Math.max(-10, Math.min(20, v || 0)); persist(); });
    const sp = app.querySelector('#simPos'); if (sp) sp.onchange = () => { st.simPos = sp.value; rerender(); };
    const sr = app.querySelector('#simPct'); if (sr) sr.onchange = () => { st.simPct = +sr.value; rerender(); };
    const h = app.querySelector('#planHealth'); if (h) h.onclick = () => runHealth(rerender);
  }
  window.Plan = { render, bind, alerts, alertEvents, alertsHtml, setHealth: d => { st.health = d; st.healthAt = Date.now(); } };
})();
