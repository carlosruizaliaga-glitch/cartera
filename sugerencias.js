// SUGERENCIAS (dentro de Análisis): cómo equilibrar la cartera comprando empresas de dividendo solventes y bien de precio.
// Las fichas (deuda, payout, historial de dividendo, precio frente a su media de 5 años, previsiones…) las calcula la función "ct-screen".
// Orientativo: no es asesoramiento financiero.
(function () {
  'use strict';
  const S = window.Store, M = window.Market;
  const U = () => window.UI;
  const LS = 'cartera.sug.v1';

  // Lista base: empresas de dividendo consolidadas (EE. UU. y Europa). Se puede ampliar o recortar desde la pantalla.
  const BASE = ['JNJ', 'KO', 'PEP', 'WMT', 'HD', 'LOW', 'ABBV', 'MRK', 'PFE', 'AMGN', 'CVX', 'XOM', 'TXN', 'ADP', 'LMT', 'GD', 'ITW', 'EMR', 'CAT', 'UPS',
    'SPG', 'PLD', 'ED', 'DUK', 'SO', 'NEE', 'AEP', 'XEL', 'WEC', 'KMB', 'CL', 'GIS', 'HSY', 'MDLZ', 'SYY', 'ADM', 'BDX', 'MDT', 'ABT', 'TROW', 'BLK', 'JPM',
    'CME', 'MO', 'PM', 'MA', 'UNP', 'AFL', 'CINF', 'PPG', 'APD', 'LIN', 'ECL',
    'ROG.SW', 'NOVN.SW', 'ZURN.SW', 'SAN.PA', 'TTE.PA', 'ENGI.PA', 'ORA.PA', 'BN.PA', 'OR.PA', 'MC.PA', 'AI.PA', 'SU.PA', 'SIE.DE', 'ALV.DE', 'MUV2.DE',
    'BAS.DE', 'DTE.DE', 'ENEL.MI', 'ENI.MI', 'ISP.MI', 'UNA.AS', 'ITX.MC', 'REP.MC', 'TEF.MC', 'SAN.MC', 'BBVA.MC', 'MAP.MC', 'ELE.MC', 'ENG.MC', 'RED.MC',
    'AENA.MC', 'ULVR.L', 'DGE.L', 'GSK.L', 'AZN.L', 'SHEL.L', 'NG.L', 'LGEN.L', 'UU.L'];

  const SECTOR_ES = { 'Consumer Defensive': 'Cons. defensivo', 'Healthcare': 'Salud', 'Utilities': 'Utilidades', 'Technology': 'Tecnología',
    'Communication Services': 'Serv. de comunic.', 'Industrials': 'Industrial', 'Energy': 'Energía', 'Financial Services': 'Serv. financieros',
    'Real Estate': 'Bienes raíces', 'Consumer Cyclical': 'Cons. cíclico', 'Basic Materials': 'Materias primas' };
  const COUNTRY_ES = { 'United States': 'EEUU', 'Spain': 'España', 'France': 'Francia', 'Germany': 'Alemania', 'Switzerland': 'Suiza', 'United Kingdom': 'UK',
    'Netherlands': 'Holanda', 'Canada': 'Canadá', 'Italy': 'Italia', 'Ireland': 'Irlanda', 'Belgium': 'Bélgica', 'Denmark': 'Dinamarca', 'Portugal': 'Portugal',
    'Japan': 'Japón', 'Sweden': 'Suecia', 'Finland': 'Finlandia', 'Luxembourg': 'Luxemburgo' };
  const MKT = { '.MC': 'BME', '.PA': 'EPA', '.DE': 'ETR', '.SW': 'SWX', '.L': 'LON', '.AS': 'AMS', '.MI': 'MIL', '.HK': 'HKG', '.TO': 'TSX' };
  const LEVELS = {
    strict: { label: 'ESTRICTA', payout: 0.65, nd: 2.5, years: 9, cuts: 0, roe: 0.10 },
    normal: { label: 'NORMAL', payout: 0.75, nd: 3.5, years: 7, cuts: 0, roe: 0.08 },
    flex: { label: 'FLEXIBLE', payout: 0.90, nd: 4.5, years: 5, cuts: 1, roe: 0.05 }
  };

  const store = (() => { try { return JSON.parse(localStorage.getItem(LS) || '{}'); } catch (e) { return {}; } })();
  const st = { data: store.data || {}, at: store.at || 0, running: false, done: 0, total: 0, error: null,
    amount: +store.amount || 500, level: store.level || 'normal', showOut: false, mkt: 'all' };
  const save = () => { try { localStorage.setItem(LS, JSON.stringify({ data: st.data, at: st.at, amount: st.amount, level: st.level })); } catch (e) { /* sin almacenamiento */ } };
  const settings = () => S.get('settings') || {};
  const esc = s => U().esc(s);
  const fmtPct = (v, d) => (v == null ? '—' : U().fnum(v * 100, d == null ? 1 : d) + '%');

  // ---------- Universo de candidatas ----------
  function universe(rows) {
    const sset = settings(), exclude = new Set(sset.sugExclude || []);
    const held = new Map(rows.map(r => [r.a.yahoo, r]));
    const total = rows.reduce((s, r) => s + (r.value || 0), 0), maxW = (sset.rules && sset.rules.maxPerCompany) || 7;
    const watch = S.list('asset').filter(a => a.type !== 'crypto' && a.yahoo).map(a => a.yahoo);
    const all = [...new Set([...BASE, ...(sset.sugExtra || []), ...watch])].filter(s => !exclude.has(s));
    return all.filter(s => {   // las que ya tienes solo si pesan poco
      const r = held.get(s);
      return !r || (total && r.value / total * 100 < maxW * 0.6);
    });
  }

  // ---------- Exposición actual ----------
  function exposure(rows) {
    const A = window.Analysis;
    const g = dim => Object.fromEntries(A.distribution(rows, dim).groups.map(x => [x.k, x.w * 100]));
    return { sector: g('sector'), pais: g('pais'), divisa: g('divisa'), total: rows.reduce((s, r) => s + (r.value || 0), 0) };
  }
  const curOf = c => (c === 'GBp' || c === 'GBX' ? 'GBP' : c);
  const priceEur = c => {
    if (!c.price || !c.currency) return null;
    const pence = c.currency === 'GBp' || c.currency === 'GBX', rate = M.rate(curOf(c.currency));
    return rate ? c.price * (pence ? 0.01 : 1) / rate : null;
  };

  // ---------- Puntuación ----------
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  function evaluate(c, ex, lv) {
    const fin = c.sector === 'Financial Services', re = c.sector === 'Real Estate', util = c.sector === 'Utilities';
    const heavy = util || re || c.sector === 'Communication Services';
    const bad = [], good = [], warn = [];
    // --- Filtros duros: solvencia y dividendo ---
    if (c.divYield == null || c.divYield < 0.015) bad.push('Dividendo muy bajo (' + fmtPct(c.divYield) + ')');
    if (c.divYield > 0.09) bad.push('Yield sospechosamente alto (' + fmtPct(c.divYield) + ')');
    const payout = c.payout != null ? c.payout : c.fcfPayout;
    if (!re && payout != null && payout > lv.payout) bad.push('Dividendo poco cubierto: payout ' + fmtPct(payout, 0));
    if (!fin && c.netDebtEbitda != null && c.netDebtEbitda > lv.nd + (heavy ? 1.5 : 0)) bad.push('Deuda alta: ' + U().fnum(c.netDebtEbitda, 1) + '× EBITDA');
    if (!fin && !heavy && c.currentRatio != null && c.currentRatio < 0.7) bad.push('Liquidez justa (ratio ' + U().fnum(c.currentRatio, 2) + ')');
    if (c.streak < lv.years) bad.push('Solo ' + c.streak + ' años seguidos de dividendo');
    if (c.cuts > lv.cuts) bad.push('Ha recortado el dividendo (' + c.cuts + (c.cuts > 1 ? ' veces' : ' vez') + ' en 10 años)');
    if (c.margin != null && c.margin <= 0) bad.push('Pierde dinero (margen ' + fmtPct(c.margin) + ')');
    if (c.roe != null && c.roe < lv.roe && !(c.roe < 0 && false)) bad.push('Rentabilidad baja (ROE ' + fmtPct(c.roe, 0) + ')');
    if (c.earningsGrowth != null && c.earningsGrowth < -0.25) bad.push('Beneficios cayendo (' + fmtPct(c.earningsGrowth, 0) + ')');
    if (c.price == null) bad.push('Sin precio');
    // --- Calidad (0-40) ---
    let q = 0;
    if (payout != null && !re) q += clamp(1 - payout / lv.payout, 0, 1) * 10; else q += 5;
    if (!fin && c.netDebtEbitda != null) q += clamp(1 - c.netDebtEbitda / (lv.nd + (heavy ? 1.5 : 0)), 0, 1) * 8; else q += 5;
    if (c.roe != null) q += clamp(c.roe / 0.2, 0, 1) * 8;
    q += c.cagr5 == null ? 2 : c.cagr5 >= 0.05 ? 6 : c.cagr5 >= 0.02 ? 4 : 2;
    q += clamp(c.streak / 10, 0, 1) * 8;
    q = Math.round(q);
    // --- Precio de entrada (0-40) ---
    let v = 0;
    const ratio = c.divYield && c.yield5 ? c.divYield / c.yield5 : null;
    if (ratio != null) { v += clamp((ratio - 0.8) / 0.6, 0, 1) * 12; if (ratio >= 1.1) good.push('Yield ' + U().fnum(ratio, 2) + '× su media de 5 años'); else if (ratio < 0.85) warn.push('Yield por debajo de su media (' + U().fnum(ratio, 2) + '×): cara frente a su historia'); }
    if (c.pctile5 != null) { v += (1 - c.pctile5) * 10; if (c.pctile5 < 0.35) good.push('En la parte baja de su rango de 5 años'); else if (c.pctile5 > 0.8) warn.push('Cerca de máximos de 5 años'); }
    const up = c.target && c.price && c.analysts >= 5 ? c.target / c.price - 1 : null;
    if (up != null) { v += clamp(up / 0.25, 0, 1) * 8; if (up >= 0.1) good.push('Analistas ven ' + fmtPct(up, 0) + ' de recorrido'); else if (up < -0.05) warn.push('Precio por encima del objetivo medio de analistas'); }
    if (c.fwdPe && c.pe && c.fwdPe < c.pe * 0.95) { v += 3; good.push('PER a futuro (' + U().fnum(c.fwdPe, 1) + ') menor que el actual'); }
    const disc = c.high52 && c.price ? 1 - c.price / c.high52 : null;
    if (disc != null) { v += clamp(disc / 0.3, 0, 1) * 7; if (disc >= 0.12) good.push(fmtPct(disc, 0) + ' por debajo de su máximo de 52 semanas'); }
    v = Math.round(v);
    // --- Encaje con tu cartera (0-20): ayuda a equilibrar ---
    const sec = SECTOR_ES[c.sector] || c.sector, pais = COUNTRY_ES[c.country] || c.country, cur = curOf(c.currency);
    const ws = ex.sector[sec] || 0, wp = ex.pais[pais] || 0, wc = ex.divisa[cur] || 0;
    let f = 6;
    f += ws < 5 ? 8 : ws < 12 ? 5 : ws > 20 ? -6 : 0;
    f += wp < 10 ? 6 : wp > 40 ? -6 : 0;
    f += wc < 15 ? 6 : wc > 60 ? -6 : 0;
    f = clamp(Math.round(f), 0, 20);
    if (ws < 8) good.push('Sector poco representado en tu cartera (' + U().fnum(ws, 1) + '%)'); else if (ws > 20) warn.push('Sector donde ya pesas ' + U().fnum(ws, 0) + '%');
    if (wp < 10) good.push('Aporta diversificación de país (' + esc(pais || '—') + ' ' + U().fnum(wp, 0) + '%)'); else if (wp > 40) warn.push('País donde ya pesas ' + U().fnum(wp, 0) + '%');
    if (wc < 15) good.push('Aporta diversificación de divisa (' + cur + ')'); else if (wc > 60) warn.push('Divisa donde ya pesas ' + U().fnum(wc, 0) + '%');
    if (c.streak >= 10) good.push(c.streak + ' años pagando sin recortes');
    if (c.cagr5 != null && c.cagr5 >= 0.05) good.push('Dividendo creciendo un ' + fmtPct(c.cagr5, 1) + ' anual');
    return { c, q, v, f, score: q + v + f, bad, good, warn, sec, pais, cur };
  }

  // ---------- Reparto de un importe ----------
  function allocate(list, amount, ex, rules) {
    const maxW = (rules && rules.maxPerCompany) || 7;
    const picks = [], secs = new Set();
    for (const e of list) {
      if (picks.length >= 4) break;
      if (secs.has(e.sec) && picks.length >= 2) continue;
      if (!priceEur(e.c)) continue;
      picks.push(e); secs.add(e.sec);
    }
    if (!picks.length) return { items: [], left: amount };
    const tot = picks.reduce((s, e) => s + e.score, 0), newTotal = ex.total + amount;
    let left = amount;
    const items = picks.map(e => {
      const p = priceEur(e.c);
      let alloc = amount * e.score / tot;
      alloc = Math.min(alloc, Math.max(0, newTotal * maxW / 100 * 0.9));   // no pasarte de tu límite por empresa
      const shares = Math.floor(alloc / p), cost = shares * p;
      left -= cost;
      const inc = e.c.divRate ? shares * e.c.divRate * (e.c.currency === 'GBp' ? 0.01 : 1) / (M.rate(curOf(e.c.currency)) || 1) : 0;
      return { e, shares, cost, price: p, inc, wAfter: newTotal ? cost / newTotal * 100 : 0 };
    }).filter(i => i.shares > 0);
    // Reparte el sobrante comprando acciones sueltas de las más puntuadas
    let guard = 40;
    while (guard-- > 0) {
      const it = items.find(i => i.price <= left && (i.cost + i.price) / newTotal * 100 <= maxW * 0.9);
      if (!it) break;
      it.shares++; it.cost += it.price; left -= it.price;
      it.inc = it.e.c.divRate ? it.shares * it.e.c.divRate * (it.e.c.currency === 'GBp' ? 0.01 : 1) / (M.rate(curOf(it.e.c.currency)) || 1) : 0;
      it.wAfter = it.cost / newTotal * 100;
    }
    return { items, left: Math.max(0, left), newTotal };
  }

  // ---------- Descarga de fichas ----------
  async function run(force, rerender) {
    if (st.running) return;
    const rows = U().model().rows, syms = universe(rows);
    st.running = true; st.error = null; st.done = 0; st.total = syms.length; rerender();
    try {
      for (let i = 0; i < syms.length; i += 20) {
        const batch = syms.slice(i, i + 20);
        const res = await fetch(S.BASE + '/functions/v1/ct-screen', { method: 'POST', headers: { apikey: S.KEY, 'Content-Type': 'application/json' },
          body: JSON.stringify({ secret: S.secret(), symbols: batch, force: !!force }) });
        const d = await res.json().catch(() => ({}));
        if (!res.ok || d.error) throw new Error(d.error || 'HTTP ' + res.status);
        Object.assign(st.data, d.items || {});
        st.done = Math.min(syms.length, i + batch.length); st.at = Date.now(); save(); rerender();
      }
    } catch (e) { st.error = String(e && e.message || e); }
    st.running = false; save(); rerender();
  }

  // ---------- Pantalla ----------
  function ago(ts) { const h = (Date.now() - ts) / 3600000; return h < 1 ? 'hace minutos' : h < 24 ? 'hace ' + Math.round(h) + ' h' : 'hace ' + Math.round(h / 24) + ' d'; }
  function render(rows) {
    const UI = U(), rules = Object.assign({ maxPerCompany: 7 }, settings().rules || {});
    const lv = LEVELS[st.level], ex = exposure(rows);
    const syms = universe(rows), have = syms.filter(s => st.data[s]);
    const evals = have.map(s => evaluate(st.data[s], ex, lv)).filter(e => e.c.price != null);
    const ok = evals.filter(e => !e.bad.length).sort((a, b) => b.score - a.score);
    const out = evals.filter(e => e.bad.length).sort((a, b) => b.score - a.score);
    const al = ok.length ? allocate(ok, st.amount, ex, rules) : { items: [], left: st.amount };

    // Exposición: dónde estás cargado y dónde falta
    const top = (obj, n) => Object.entries(obj).filter(([k]) => k && k !== '—' && k !== 'Cripto').sort((a, b) => b[1] - a[1]).slice(0, n);
    const over = [...top(ex.sector, 2).filter(x => x[1] > 20).map(x => x[0] + ' ' + UI.fnum(x[1], 0) + '%'), ...top(ex.pais, 1).filter(x => x[1] > 40).map(x => x[0] + ' ' + UI.fnum(x[1], 0) + '%'), ...top(ex.divisa, 1).filter(x => x[1] > 60).map(x => x[0] + ' ' + UI.fnum(x[1], 0) + '%')];
    const allSec = Object.values(SECTOR_ES), missing = allSec.filter(s => (ex.sector[s] || 0) < 3);
    const expo = `<div class="gcard"><div class="muted" style="font-size:12px">Tu cartera está cargada en <b style="color:var(--fg)">${over.length ? over.map(esc).join(', ') : 'nada fuera de lo normal'}</b>.${missing.length ? ` Sectores casi sin presencia: <b style="color:var(--fg)">${missing.slice(0, 5).map(esc).join(', ')}</b>.` : ''}</div></div>`;

    const lvBtn = `<div class="seg sm">${Object.entries(LEVELS).map(([k, o]) => `<button data-slv="${k}" class="${st.level === k ? 'on' : ''}">${o.label}</button>`).join('')}</div>`;
    const prog = st.running ? `<div class="meter" style="margin:10px 0"><i style="width:${st.total ? (st.done / st.total * 100).toFixed(0) : 0}%"></i></div><div class="muted" style="font-size:11.5px">Analizando empresas… ${st.done}/${st.total}</div>` : '';
    const ctl = `<div class="gcard"><div class="f"><div class="fld" style="margin-top:0"><label>IMPORTE A INVERTIR (€)</label><input id="sugAmt" inputmode="decimal" value="${st.amount}"></div></div>
      <div class="muted" style="font-size:11px;margin:12px 0 6px">EXIGENCIA DE SOLVENCIA</div>${lvBtn}
      <div class="bk" style="margin-top:10px"><button id="sugRun" class="primary" ${st.running ? 'disabled' : ''}>${st.running ? 'ANALIZANDO…' : st.at ? '↻ ACTUALIZAR ANÁLISIS' : '⚡ ANALIZAR EMPRESAS'}</button></div>${prog}
      <div class="muted" style="font-size:11px;margin-top:8px">${st.at ? 'Datos ' + ago(st.at) + ' · ' + have.length + ' de ' + syms.length + ' empresas analizadas.' : 'Analiza unas ' + syms.length + ' empresas de dividendo (tarda 1-2 minutos la primera vez).'}${st.error ? `<br><span class="down">Error: ${esc(st.error)}</span>` : ''}</div></div>`;

    const alHtml = al.items.length ? `<h2><span>REPARTO SUGERIDO · ${UI.eur(st.amount, 0)}</span></h2><div class="gcard rowsc">${al.items.map(i => {
      const e = i.e, wsBefore = ex.sector[e.sec] || 0, wsAfter = ((wsBefore / 100 * ex.total) + i.cost) / al.newTotal * 100;
      return `<div class="sugrow" data-sugd="${esc(e.c.sym)}"><div class="sh">${UI.logoHtml({ ticker: e.c.sym, yahoo: e.c.sym, type: 'stock' }, null)}<div class="mid"><div class="tk">${esc(e.c.sym)} <span class="muted">· ${i.shares} acc.</span></div><div class="nm">${esc(e.c.name)}</div></div><div class="rt"><div class="val">${UI.eur(i.cost, 0)}</div><div class="sub yellow">+${UI.eur(i.inc, 0)}/año</div></div></div>
        <div class="nm" style="margin-top:4px">Peso tras comprar ${UI.fnum(i.wAfter, 1)}% · ${esc(e.sec)} ${UI.fnum(wsBefore, 1)}% → ${UI.fnum(wsAfter, 1)}%</div></div>`;
    }).join('')}<div class="muted" style="font-size:11.5px;padding:10px 0 4px">Reparto en proporción a la nota de cada una, máximo una por sector a partir de la segunda, sin pasar tu límite por empresa (${UI.fnum(rules.maxPerCompany, 0)}%). Sobran ${UI.eur(al.left, 0)} por acciones enteras. La renta es bruta.</div></div>` : '';

    const rank = ok.length ? `<h2><span>CANDIDATAS · ${ok.length}</span></h2>${ok.slice(0, 15).map(e => card(e)).join('')}` : (have.length ? `<div class="gcard"><div class="muted">Ninguna candidata pasa con exigencia ${lv.label.toLowerCase()}. Prueba con FLEXIBLE.</div></div>` : '');
    const outHtml = out.length ? `<button class="more" id="sugOut">${st.showOut ? 'OCULTAR' : 'VER'} DESCARTADAS (${out.length})</button>${st.showOut ? out.slice(0, 40).map(e => card(e, true)).join('') : ''}` : '';
    const extra = `<h2><span>AÑADIR EMPRESA A VIGILAR</span></h2><div class="gcard"><div class="inrow"><input id="sugAdd" class="sugin" autocapitalize="characters" placeholder="Símbolo de Yahoo: KO, ITX.MC, NESN.SW…"><button id="sugAddB" class="mini">+ AÑADIR</button></div></div>`;
    return `<div class="muted" style="font-size:11.5px;margin:12px 2px 0">Busca empresas de dividendo solventes y con buen precio de entrada que además ayuden a equilibrar tu cartera. Orientativo, no es asesoramiento financiero.</div>
      ${ctl}${expo}${alHtml}${rank}${outHtml}${extra}`;
  }

  function card(e, out) {
    const UI = U(), c = e.c, why = (out ? e.bad : e.good.slice(0, 3));
    return `<div class="gcard sug${out ? ' out' : ''}" data-sugd="${esc(c.sym)}"><div class="sh">${UI.logoHtml({ ticker: c.sym, yahoo: c.sym, type: 'stock' }, null)}
      <div class="mid"><div class="tk">${esc(c.sym)}<span class="muted"> · ${esc(e.sec || '')}${e.pais ? ' · ' + esc(e.pais) : ''}</span></div><div class="nm ellipsis">${esc(c.name)}</div></div>
      <div class="rt"><div class="score ${e.score >= 70 ? 'g' : e.score >= 50 ? 'y' : 'r'}">${e.score}</div><div class="sub dim">yield ${fmtPct(c.divYield)}</div></div></div>
      <div class="why">${why.map(w => `<span class="${out ? 'bd' : 'gd'}">${out ? '✕' : '✓'} ${esc(w)}</span>`).join('')}${!out ? e.warn.slice(0, 2).map(w => `<span class="wn">! ${esc(w)}</span>`).join('') : ''}</div></div>`;
  }

  function detail(sym, rows) {
    const UI = U(), c = st.data[sym]; if (!c) return;
    const ex = exposure(rows), e = evaluate(c, ex, LEVELS[st.level]);
    const kv = [['Precio', c.price != null ? UI.price(c.price, c.currency) : '—'], ['Capitalización', c.marketCap ? UI.fnum(c.marketCap / 1e9, 1) + ' mil M' : '—'],
      ['Dividendo / yield', (c.divRate != null ? UI.price(c.divRate, c.currency) : '—') + ' · ' + fmtPct(c.divYield)], ['Yield medio 5 años', fmtPct(c.yield5)],
      ['Payout (beneficio / caja)', fmtPct(c.payout, 0) + ' / ' + fmtPct(c.fcfPayout, 0)], ['Años de dividendo seguidos', c.streak + (c.cuts ? ' · ' + c.cuts + ' recorte(s)' : '')],
      ['Crecimiento dividendo 5 a.', fmtPct(c.cagr5)], ['Deuda neta / EBITDA', c.netDebtEbitda != null ? UI.fnum(c.netDebtEbitda, 1) + '×' : '—'], ['Liquidez corriente', c.currentRatio != null ? UI.fnum(c.currentRatio, 2) : '—'],
      ['ROE / margen', fmtPct(c.roe, 0) + ' / ' + fmtPct(c.margin, 0)], ['PER / PER futuro', (c.pe != null ? UI.fnum(c.pe, 1) : '—') + ' / ' + (c.fwdPe != null ? UI.fnum(c.fwdPe, 1) : '—')],
      ['Objetivo analistas', c.target ? UI.price(c.target, c.currency) + (c.price ? ' (' + UI.sPct(c.target / c.price - 1) + ')' : '') : '—'], ['Posición en rango 5 años', c.pctile5 != null ? UI.fnum(c.pctile5 * 100, 0) + '% (0 = mínimo)' : '—'],
      ['Frente al máx. 52 semanas', c.high52 && c.price ? UI.sPct(c.price / c.high52 - 1) : '—']];
    const bg = UI.sheet(`<div class="hd"><div class="t">${esc(c.sym)} · NOTA ${e.score}/100</div><button data-close>✕</button></div>
      <div class="muted" style="margin-bottom:8px">${esc(c.name)} · ${esc(e.sec || '')} · ${esc(e.pais || '')}</div>
      <div class="kv" style="margin-bottom:10px">${kv.map(r => `<div class="k">${r[0]}</div><div class="v">${r[1]}</div>`).join('')}</div>
      <div class="muted" style="font-size:11.5px">Calidad ${e.q}/40 · Precio ${e.v}/40 · Encaje con tu cartera ${e.f}/20</div>
      <div class="why" style="margin:10px 0">${e.bad.map(w => `<span class="bd">✕ ${esc(w)}</span>`).join('')}${e.good.map(w => `<span class="gd">✓ ${esc(w)}</span>`).join('')}${e.warn.map(w => `<span class="wn">! ${esc(w)}</span>`).join('')}</div>
      <div class="bk2" style="margin-top:12px"><button id="sugFollow" class="primary">SEGUIR ESTA EMPRESA</button><button id="sugDrop" class="out">NO SUGERIR MÁS</button></div>`);
    bg.querySelector('#sugFollow').onclick = () => {
      const m = Object.keys(MKT).find(x => sym.endsWith(x));
      bg.remove(); window.Forms.openAssetForm({ ticker: m ? sym.slice(0, -m.length) : sym, market: m ? MKT[m] : 'US' });
    };
    bg.querySelector('#sugDrop').onclick = () => { const s = settings(); S.put('settings', Object.assign({}, s, { sugExclude: [...new Set([...(s.sugExclude || []), sym])] })); bg.remove(); UI.toast('No volveré a sugerirla'); UI.render(); };
  }

  function bind(app, rerender) {
    const rows = U().model().rows;
    const amt = app.querySelector('#sugAmt');
    if (amt) amt.onchange = () => { const v = window.Forms.parseNum(amt.value); if (v > 0) { st.amount = v; save(); rerender(); } };
    app.querySelectorAll('[data-slv]').forEach(b => b.onclick = () => { st.level = b.dataset.slv; save(); rerender(); });
    const r = app.querySelector('#sugRun'); if (r) r.onclick = () => run(!!st.at, rerender);
    const o = app.querySelector('#sugOut'); if (o) o.onclick = () => { st.showOut = !st.showOut; rerender(); };
    app.querySelectorAll('[data-sugd]').forEach(el => el.onclick = () => detail(el.dataset.sugd, rows));
    const add = app.querySelector('#sugAddB');
    if (add) add.onclick = () => {
      const v = (app.querySelector('#sugAdd').value || '').trim().toUpperCase().replace(/[^A-Z0-9.\-]/g, '');
      if (!v) return;
      const s = settings(); S.put('settings', Object.assign({}, s, { sugExtra: [...new Set([...(s.sugExtra || []), v])], sugExclude: (s.sugExclude || []).filter(x => x !== v) }));
      U().toast(v + ' añadida: pulsa ACTUALIZAR ANÁLISIS'); rerender();
    };
  }

  window.Suggest = { render, bind, setData: d => { st.data = d; st.at = Date.now(); }, BASE };
})();
