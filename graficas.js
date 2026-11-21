// Pestaña GRÁFICAS (dentro de Análisis): cobros por mes, renta cobrada, cartera frente a un índice,
// ganadores y perdedores, renta por empresa y mapa de calor mensual.
(function () {
  'use strict';
  const S = window.Store, M = window.Market, C = window.Calc;
  const U = () => window.UI;
  const lines = {};
  const st = { cobrada: 'year', bm: '^GSPC', range: '1A', win: 'eur' };
  const PAL = ['#43E8C0', '#FFD36E', '#7ad9f5', '#b9a4e0', '#ffb86c', '#ff6b6b'];
  const GREY = '#93a8a6';
  const MES = ['ENE', 'FEB', 'MAR', 'ABR', 'MAY', 'JUN', 'JUL', 'AGO', 'SEP', 'OCT', 'NOV', 'DIC'];
  const BENCH = [['^GSPC', 'S&P 500'], ['URTH', 'MSCI WORLD']];

  const tip = (lines) => ' data-tip="' + lines.map(l => String(l).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')).join('|') + '"';
  const esc = s => U().esc(s);

  const seg = (k, cur, list) => `<div class="seg sm">${list.map(o => `<button data-g${k}="${o[0]}" class="${cur === o[0] ? 'on' : ''}">${o[1]}</button>`).join('')}</div>`;
  const card = (title, sub, inner, tail) => `<h2><span>${title}</span>${tail || ''}</h2>${sub ? `<div class="muted" style="font-size:11.5px;margin:-2px 2px 8px">${sub}</div>` : ''}${inner}`;

  // ---------- 1) Cobros por mes (próximos 12 meses, apilado por empresa) ----------
  function cobrosMes(rows) {
    const UI = U(), t = UI.today();
    const assets = rows.filter(r => r.a.type !== 'crypto').map(r => r.a);
    const evs = window.Divs.upcoming(assets, { back: 0, horizon: 366 }).filter(e => e.pay >= t && e.qty > 0 && e.net > 0);
    const y0 = +t.slice(0, 4), m0 = +t.slice(5, 7) - 1;
    const months = Array.from({ length: 12 }, (_, i) => { const d = new Date(Date.UTC(y0, m0 + i, 1)); return { key: d.toISOString().slice(0, 7), m: d.getUTCMonth(), y: d.getUTCFullYear(), by: {}, tot: 0 }; });
    const byKey = Object.fromEntries(months.map(m => [m.key, m]));
    const sumBy = {};
    evs.forEach(e => {
      const m = byKey[e.pay.slice(0, 7)]; if (!m) return;
      m.by[e.asset.ticker] = (m.by[e.asset.ticker] || 0) + e.net; m.tot += e.net;
      sumBy[e.asset.ticker] = (sumBy[e.asset.ticker] || 0) + e.net;
    });
    const top = Object.keys(sumBy).sort((a, b) => sumBy[b] - sumBy[a]).slice(0, 6);
    const col = k => { const i = top.indexOf(k); return i < 0 ? GREY : PAL[i]; };
    const max = Math.max(1, ...months.map(m => m.tot)), W = 360, H = 150, bw = 22, gap = (W - bw * 12) / 11;
    const bars = months.map((m, i) => {
      let y = H; const x = i * (bw + gap);
      const segs = Object.keys(m.by).sort((a, b) => (top.indexOf(a) < 0 ? 9 : top.indexOf(a)) - (top.indexOf(b) < 0 ? 9 : top.indexOf(b))).map(k => {
        const h = m.by[k] / max * (H - 8); y -= h;
        return `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${bw}" height="${Math.max(h, 0.5).toFixed(1)}" fill="${col(k)}" rx="2"/>`;
      }).join('');
      const tl = [MES[m.m] + ' ' + m.y + ' · ' + UI.eur(m.tot, 0)].concat(Object.keys(m.by).sort((a, b) => m.by[b] - m.by[a]).map(k => k + '  ' + UI.eur(m.by[k], 0)));
      return `<g${tip(m.tot > 0 ? tl : [MES[m.m] + ' ' + m.y, 'Sin cobros previstos'])}><rect x="${(x - gap / 2).toFixed(1)}" y="0" width="${(bw + gap).toFixed(1)}" height="${H + 20}" fill="transparent"/>${segs}<text x="${(x + bw / 2).toFixed(1)}" y="${H + 14}" text-anchor="middle" class="ax">${MES[m.m]}</text></g>`;
    }).join('');
    const total = months.reduce((s, m) => s + m.tot, 0);
    const legend = `<div class="gl">${top.map(k => `<span><i style="background:${col(k)}"></i>${UI.esc(k)}</span>`).join('')}${Object.keys(sumBy).length > top.length ? `<span><i style="background:${GREY}"></i>OTRAS</span>` : ''}</div>`;
    const list = months.filter(m => m.tot > 0).map(m => `<div class="grow"><b>${MES[m.m]} ${String(m.y).slice(2)}</b><span class="mu">${Object.keys(m.by).sort((a, b) => m.by[b] - m.by[a]).slice(0, 3).map(UI.esc).join(' · ')}</span><em class="yellow">${UI.eur(m.tot, 0)}</em></div>`).join('');
    return card('COBROS POR MES', `Próximos 12 meses · neto previsto <b class="yellow">${UI.eur(total, 0)}</b> (los meses estimados repiten el calendario del último año).`,
      `<div class="gcard"><svg viewBox="0 0 ${W} ${H + 20}" class="gsvg">${bars}</svg>${legend}</div><div class="gcard rowsc">${list || '<div class="muted">Sin cobros previstos.</div>'}</div>`);
  }

  // ---------- 2) Renta cobrada por año / trimestre ----------
  function cobrada() {
    const UI = U();
    const paid = S.list('dividend').filter(d => d.status !== 'pending' && d.date && d.net);
    const key = d => st.cobrada === 'year' ? d.date.slice(0, 4) : d.date.slice(0, 4) + ' T' + (Math.floor((+d.date.slice(5, 7) - 1) / 3) + 1);
    const g = {}; paid.forEach(d => { g[key(d)] = (g[key(d)] || 0) + d.net; });
    let keys = Object.keys(g).sort();
    if (st.cobrada !== 'year') keys = keys.slice(-8);
    const goal = (S.get('settings') || {}).incomeGoal;
    const max = Math.max(1, ...keys.map(k => g[k]), st.cobrada === 'year' && goal ? goal : 0);
    const W = 360, H = 140, n = Math.max(keys.length, 1), bw = Math.min(48, (W - (n - 1) * 10) / n), gap = n > 1 ? (W - bw * n) / (n - 1) : 0;
    const x0 = n > 1 ? 0 : (W - bw) / 2;
    const bars = keys.map((k, i) => {
      const h = g[k] / max * (H - 18), x = x0 + i * (bw + gap);
      const np = paid.filter(d => key(d) === k).length;
      return `<g${tip([k + ' · ' + UI.eur(g[k], 0), np + (np === 1 ? ' pago' : ' pagos')])}><rect x="${(x - 4).toFixed(1)}" y="0" width="${(bw + 8).toFixed(1)}" height="${H + 20}" fill="transparent"/><rect x="${x.toFixed(1)}" y="${(H - h).toFixed(1)}" width="${bw.toFixed(1)}" height="${h.toFixed(1)}" rx="4" fill="${PAL[1]}"/><text x="${(x + bw / 2).toFixed(1)}" y="${H + 14}" text-anchor="middle" class="ax">${k.replace(/^\d{2}/, '')}</text></g>`;
    }).join('');
    const gy = st.cobrada === 'year' && goal ? H - goal / max * (H - 18) : null;
    const line = gy != null ? `<line x1="0" x2="${W}" y1="${gy.toFixed(1)}" y2="${gy.toFixed(1)}" stroke="${PAL[0]}" stroke-dasharray="5 5" stroke-width="2"/><text x="${W - 2}" y="${(gy - 4).toFixed(1)}" text-anchor="end" class="ax" fill="${PAL[0]}">OBJETIVO ${UI.eur(goal, 0)}</text>` : '';
    const list = keys.slice().reverse().map(k => `<div class="grow"><b>${k}</b><span class="mu"></span><em class="yellow">${UI.eur(g[k], 0)}</em></div>`).join('');
    return card('RENTA COBRADA', 'Dividendos netos cobrados.', seg('cob', st.cobrada, [['year', 'POR AÑO'], ['q', 'POR TRIMESTRE']]) +
      `<div class="gcard">${keys.length ? `<svg viewBox="0 0 ${W} ${H + 20}" class="gsvg">${line}${bars}</svg>` : '<div class="muted">Aún no hay dividendos cobrados.</div>'}</div><div class="gcard rowsc">${list}</div>`);
  }

  // ---------- 3) Cartera frente a un índice ----------
  const addDays = (iso, n) => C.addDays(iso, n);
  function startFor(r, t) {
    if (r === '1M') return addDays(t, -30);
    if (r === 'YTD') return addDays(t.slice(0, 4) + '-01-01', -1);
    if (r === '1A') return addDays(t, -365);
    return null;
  }
  function twr(series) {
    const out = []; let idx = 100;
    series.forEach((p, i) => {
      if (i) { const prev = series[i - 1].v; idx *= prev > 0 ? 1 + (p.v - (p.flow || 0)) / prev - 1 : 1; }
      out.push({ d: p.d, idx });
    });
    return out;
  }
  function vsIndex(mdl) {
    const UI = U(), t = UI.today();
    const all = UI.seriesFor(mdl, 'all');
    const from = startFor(st.range, t);
    let pts = from ? all.filter(p => p.d >= from) : all;
    const bmName = (BENCH.find(b => b[0] === st.bm) || [])[1];
    const ctl = seg('bm', st.bm, BENCH) + seg('rng', st.range, [['1M', '1M'], ['YTD', 'YTD'], ['1A', '1A'], ['TODO', 'TODO']]);
    if (pts.length < 3) return card('FRENTE A UN ÍNDICE', '', ctl + '<div class="gcard"><div class="muted">Sin histórico suficiente.</div></div>');
    const mine = twr(pts); const k0 = mine[0].idx; mine.forEach(p => { p.idx = p.idx / k0 * 100; });
    const h = M.history({ type: 'stock', yahoo: st.bm, currency: 'USD' }).closes, days = Object.keys(h).sort();
    let bm = null;
    if (days.length > 2) {
      let j = 0, last = null;
      const raw = pts.map(p => { while (j < days.length && days[j] <= p.d) { last = h[days[j]]; j++; } return last; });
      const base = raw.find(v => v != null);
      if (base) bm = raw.map(v => (v == null ? base : v) / base * 100);
    }
    const all2 = mine.map(p => p.idx).concat(bm || []);
    let lo = Math.min(...all2), hi = Math.max(...all2); if (hi - lo < 1) { hi += 1; lo -= 1; }
    const W = 360, H = 170, x = i => i / (mine.length - 1) * W, y = v => 8 + (1 - (v - lo) / (hi - lo)) * (H - 16);
    const path = arr => arr.map((v, i) => (i ? 'L' : 'M') + x(i).toFixed(1) + ' ' + y(v).toFixed(1)).join('');
    const fin = mine[mine.length - 1].idx - 100, fb = bm ? bm[bm.length - 1] - 100 : null;
    const sg = v => (v >= 0 ? '+' : '−') + UI.fnum(Math.abs(v), 1) + '%';
    lines.vs = { dates: pts.map(p => p.d), a: mine.map(p => p.idx), b: bm, name: bmName };
    const svg = `<svg viewBox="0 0 ${W} ${H}" class="gsvg" data-lc="vs" preserveAspectRatio="none"><line x1="0" x2="${W}" y1="${y(100).toFixed(1)}" y2="${y(100).toFixed(1)}" stroke="var(--line2)" stroke-dasharray="3 4" vector-effect="non-scaling-stroke"/>
      ${bm ? `<path d="${path(bm)}" fill="none" stroke="${PAL[1]}" stroke-width="2" vector-effect="non-scaling-stroke" stroke-linejoin="round"/>` : ''}
      <path d="${path(mine.map(p => p.idx))}" fill="none" stroke="${PAL[0]}" stroke-width="2.4" vector-effect="non-scaling-stroke" stroke-linejoin="round"/><line id="lcx" x1="0" x2="0" y1="0" y2="${H}" stroke="#e8f1ef" stroke-width="1" vector-effect="non-scaling-stroke" visibility="hidden"/></svg>`;
    const leg = `<div class="gl"><span><i style="background:${PAL[0]}"></i>TU CARTERA <b class="${fin >= 0 ? 'up' : 'down'}">${sg(fin)}</b></span>${bm ? `<span><i style="background:${PAL[1]}"></i>${bmName} <b>${sg(fb)}</b></span>` : ''}</div>`;
    const note = bm ? `Rentabilidad sin contar lo que aportas o retiras. ${fin >= fb ? 'Vas por delante' : 'Vas por detrás'} del ${bmName} en este periodo (${sg(fin - fb)} de diferencia). El índice se mide en su divisa, sin cambio a euros.` : `Todavía no hay datos del ${bmName}: se descargan con la próxima actualización de precios (tira de la pantalla hacia abajo).`;
    return card('FRENTE A UN ÍNDICE', 'Tu cartera y el índice, empezando los dos en 100.', ctl + `<div class="gcard">${svg}${leg}<div class="muted" style="font-size:11px;margin-top:6px">${note}</div></div>`);
  }

  // ---------- 4) Ganadores y perdedores ----------
  function ganadores(rows) {
    const UI = U();
    const ok = rows.filter(r => r.pl != null);
    const val = r => (st.win === 'pct' ? (r.plPct || 0) * 100 : r.pl);
    const list = ok.slice().sort((a, b) => val(b) - val(a));
    const max = Math.max(1e-9, ...list.map(r => Math.abs(val(r))));
    const body = list.map(r => {
      const v = val(r), w = Math.abs(v) / max * 50, up = v >= 0;
      return `<div class="gr" data-id="${UI.esc(r.a.id)}"${tip([r.a.ticker + ' · ' + (r.a.name || ''), 'P/L ' + UI.sEur(r.pl, 0) + ' (' + UI.sPct(r.plPct) + ')', 'Valor ' + UI.eur(r.value, 0), 'Coste ' + UI.eur(r.p.costEur, 0)])}><span class="tk">${UI.esc(r.a.ticker)}</span><div class="gt"><i class="${up ? 'p' : 'n'}" style="width:${w.toFixed(1)}%"></i></div><b class="${up ? 'up' : 'down'}">${st.win === 'pct' ? UI.sPct(r.plPct) : UI.sEur(r.pl, 0)}</b></div>`;
    }).join('');
    return card('GANADORES Y PERDEDORES', 'P/L latente de cada posición, de mejor a peor.', seg('win', st.win, [['eur', 'EN €'], ['pct', 'EN %']]) + `<div class="gcard">${body || '<div class="muted">Sin posiciones.</div>'}</div>`);
  }

  // ---------- 5) Renta por empresa ----------
  function rentaEmpresa(rows) {
    const UI = U();
    const fc = window.Divs.forecast(rows.filter(r => r.a.type !== 'crypto'));
    const max = Math.max(1, ...fc.by.map(b => b.net));
    const body = fc.by.map(b => `<div class="gr" data-id="${UI.esc(b.a.id)}"${tip([b.a.ticker + ' · ' + (b.a.name || ''), 'Neto/año ' + UI.eur(b.net, 0), 'Bruto/año ' + UI.eur(b.gross, 0), 'Yield ' + UI.fnum(b.yld * 100, 1) + '%  YoC ' + UI.fnum(b.yoc * 100, 1) + '%'])}><span class="tk">${UI.esc(b.a.ticker)}</span><div class="gt one"><i class="y" style="width:${(b.net / max * 100).toFixed(1)}%"></i></div><b class="yellow">${UI.eur(b.net, 0)}</b><em class="sm">${UI.fnum(b.net / (fc.net || 1) * 100, 0)}% · yield ${UI.fnum(b.yld * 100, 1)}% · YoC ${UI.fnum(b.yoc * 100, 1)}%</em></div>`).join('');
    return card('RENTA POR EMPRESA', `Quién aporta tu renta prevista de <b class="yellow">${UI.eur(fc.net, 0)}</b> netos al año.`, `<div class="gcard">${body || '<div class="muted">Sin dividendos previstos.</div>'}</div>`);
  }

  // ---------- 6) Mapa de calor mensual ----------
  const heatColor = p => {
    const t = Math.max(-1, Math.min(1, p / 6)), k = Math.abs(t), n = [38, 55, 58], g = t >= 0 ? [20, 163, 127] : [214, 69, 77];
    const c = n.map((v, i) => Math.round(v + (g[i] - v) * (k ? 0.25 + 0.75 * k : 0)));
    return `rgb(${c[0]},${c[1]},${c[2]})`;
  };
  function calor(mdl) {
    const UI = U();
    const all = UI.seriesFor(mdl, 'all');
    if (all.length < 5) return '';
    const m = {};   // 'YYYY-MM' -> factor
    for (let i = 1; i < all.length; i++) {
      const prev = all[i - 1].v; if (prev <= 0) continue;
      const f = 1 + (all[i].v - (all[i].flow || 0)) / prev - 1, k = all[i].d.slice(0, 7);
      m[k] = (m[k] || 1) * f;
    }
    const years = [...new Set(Object.keys(m).map(k => k.slice(0, 4)))].sort().reverse().slice(0, 4);
    const head = `<div class="hm hh"><span></span>${MES.map(x => `<span>${x[0]}</span>`).join('')}<span>AÑO</span></div>`;
    const rowsH = years.map(y => {
      let tot = 1, any = false;
      const cells = MES.map((_, i) => {
        const k = y + '-' + String(i + 1).padStart(2, '0'), f = m[k];
        if (f == null) return '<span class="e"></span>';
        any = true; tot *= f; const p = (f - 1) * 100;
        return `<span${tip([MES[i] + ' ' + y, (p >= 0 ? '+' : '−') + UI.fnum(Math.abs(p), 2) + '% en el mes'])} style="background:${heatColor(p)}">${UI.fnum(Math.abs(p), Math.abs(p) >= 10 ? 0 : 1).replace(',0', '')}</span>`;
      }).join('');
      const py = (tot - 1) * 100;
      return `<div class="hm"><b>${y.slice(2)}</b>${cells}<span class="yr" style="color:${py >= 0 ? 'var(--green)' : 'var(--red)'}">${any ? (py >= 0 ? '+' : '−') + UI.fnum(Math.abs(py), 0) : ''}</span></div>`;
    }).join('');
    return card('MAPA DE CALOR MENSUAL', 'Rentabilidad de tu cartera cada mes (en %), sin contar aportaciones. Verde sube, rojo baja.', `<div class="gcard hmc">${head}${rowsH}</div>`);
  }

  function render(rows) {
    const mdl = U().model();
    const parts = [cobrosMes(rows), cobrada(), vsIndex(mdl), ganadores(rows), rentaEmpresa(rows), calor(mdl)];
    return parts.join('');
  }
  function bind(app, rerender) {
    app.querySelectorAll('[data-gcob]').forEach(b => b.onclick = () => { st.cobrada = b.dataset.gcob; rerender(); });
    app.querySelectorAll('[data-gbm]').forEach(b => b.onclick = () => { st.bm = b.dataset.gbm; rerender(); });
    app.querySelectorAll('[data-grng]').forEach(b => b.onclick = () => { st.range = b.dataset.grng; rerender(); });
    app.querySelectorAll('[data-gwin]').forEach(b => b.onclick = () => { st.win = b.dataset.gwin; rerender(); });
  }

  // ---------- Cuadro de info al pasar el dedo (como en la gráfica de Inicio) ----------
  let box = null;
  function showTip(lines, x, y) {
    if (!box) { box = document.createElement('div'); box.className = 'gtip'; document.body.appendChild(box); }
    const UI = U();
    box.innerHTML = lines.map((l, i) => i === 0 ? `<b>${UI.esc(l)}</b>` : `<span>${UI.esc(l)}</span>`).join('');
    box.style.display = 'block';
    const w = box.offsetWidth, h = box.offsetHeight;
    let left = Math.max(8, Math.min(innerWidth - w - 8, x - w / 2));
    let top = y - h - 28; if (top < 70) top = y + 36;
    box.style.left = left + 'px'; box.style.top = top + 'px';
  }
  const hideTip = () => { if (box) box.style.display = 'none'; document.querySelectorAll('#lcx').forEach(l => l.setAttribute('visibility', 'hidden')); };
  function lineTip(svg, cx, cy) {
    const L = lines[svg.dataset.lc]; if (!L) return false;
    const r = svg.getBoundingClientRect(), n = L.dates.length;
    const i = Math.max(0, Math.min(n - 1, Math.round((cx - r.left) / r.width * (n - 1))));
    const X = i / (n - 1) * 360, ln = svg.querySelector('#lcx');
    ln.setAttribute('x1', X); ln.setAttribute('x2', X); ln.setAttribute('visibility', 'visible');
    const sg = v => (v >= 0 ? '+' : '−') + U().fnum(Math.abs(v), 1) + '%';
    const out = [U().fdate(L.dates[i]), 'Tu cartera ' + sg(L.a[i] - 100)];
    if (L.b) out.push(L.name + ' ' + sg(L.b[i] - 100));
    showTip(out, cx, cy);
    return true;
  }
  function tips(root) {
    if (root.__tips) return; root.__tips = true;
    let on = false;
    const at = (cx, cy) => {
      const el = document.elementFromPoint(cx, cy); if (!el) return hideTip();
      const lc = el.closest && el.closest('[data-lc]');
      if (lc) return lineTip(lc, cx, cy);
      const t = el.closest && el.closest('[data-tip]');
      if (t) { document.querySelectorAll('#lcx').forEach(l => l.setAttribute('visibility', 'hidden')); showTip(t.dataset.tip.split('|'), cx, cy); } else hideTip();
    };
    const pt = e => e.touches ? e.touches[0] : e;
    const sel = '[data-tip],[data-lc]';
    root.addEventListener('touchstart', e => { if (e.target.closest(sel)) { on = true; const p = pt(e); at(p.clientX, p.clientY); } }, { passive: true });
    root.addEventListener('touchmove', e => { if (on) { const p = pt(e); at(p.clientX, p.clientY); } }, { passive: true });
    ['touchend', 'touchcancel'].forEach(ev => root.addEventListener(ev, () => { on = false; setTimeout(hideTip, 900); }));
    root.addEventListener('mousemove', e => { if (e.target.closest && e.target.closest(sel)) at(e.clientX, e.clientY); else hideTip(); });
    root.addEventListener('mouseleave', hideTip);
    window.addEventListener('scroll', hideTip, { passive: true });
  }
  window.Charts = { render, bind, BENCH, tips, tip };
})();
