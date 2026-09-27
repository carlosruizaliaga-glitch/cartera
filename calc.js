// Cálculos de cartera: posiciones FIFO, plusvalías realizadas y evolución diaria del valor.
// Todo en euros; cada operación guarda su total en € (totalEur) tal y como se apuntó.
(function (root) {
  'use strict';
  const EPS = 1e-9;
  const isAcq = t => t === 'buy' || t === 'scrip' || t === 'earn';

  function sortTx(txs) {
    return txs.slice().sort((a, b) => a.date < b.date ? -1 : a.date > b.date ? 1
      : (a.type === 'sell') - (b.type === 'sell') || (a.id < b.id ? -1 : 1));
  }

  // Posiciones por activo con lotes FIFO.
  function positions(txs) {
    const by = {};
    sortTx(txs).forEach(x => {
      const p = by[x.asset] || (by[x.asset] = { asset: x.asset, lots: [], realized: {}, sales: [], txs: [], firstDate: x.date });
      p.txs.push(x);
      if (isAcq(x.type)) {
        if (x.qty > 0) p.lots.push({ qty: x.qty, unitEur: (x.totalEur || 0) / x.qty, unitLocal: x.price || 0, date: x.date, tx: x.id });
        return;
      }
      if (x.type !== 'sell') return;
      let left = x.qty, cost = 0;
      const used = [];
      while (left > EPS && p.lots.length) {
        const lot = p.lots[0], take = Math.min(left, lot.qty);
        cost += take * lot.unitEur; lot.qty -= take; left -= take;
        used.push({ date: lot.date, qty: take, unitEur: lot.unitEur });
        if (lot.qty <= EPS) p.lots.shift();
      }
      const pl = (x.totalEur || 0) - cost, y = x.date.slice(0, 4);
      p.realized[y] = (p.realized[y] || 0) + pl;
      p.sales.push({ tx: x, cost, proceeds: x.totalEur || 0, pl, lots: used, short: left > EPS ? left : 0 });
    });
    Object.values(by).forEach(p => {
      p.qty = p.lots.reduce((s, l) => s + l.qty, 0);
      if (p.qty < EPS) p.qty = 0;
      p.costEur = p.lots.reduce((s, l) => s + l.qty * l.unitEur, 0);
      p.avgLocal = p.qty ? p.lots.reduce((s, l) => s + l.qty * l.unitLocal, 0) / p.qty : 0;
    });
    return by;
  }

  // Lotes que quedarían y plusvalía de una venta hipotética (para el formulario de venta).
  function simulateSale(txs, assetId, qty, totalEur) {
    const p = positions(txs.filter(t => t.asset === assetId))[assetId];
    if (!p) return null;
    let left = qty, cost = 0;
    for (const lot of p.lots) { const take = Math.min(left, lot.qty); cost += take * lot.unitEur; left -= take; if (left <= EPS) break; }
    return { cost, pl: totalEur - cost, short: left > EPS ? left : 0, available: p.qty };
  }

  const addDays = (iso, n) => { const d = new Date(iso + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

  // Serie diaria del valor (en €) y de las aportaciones netas.
  // hist(asset) -> { closes: {día: precio}, currency }, fxh: {día: {USD: 1.1, ...}}.
  // live(asset) -> { price, currency } se usa si no hay histórico de ese activo.
  function series(txs, assetsById, hist, fxh, today, live) {
    const list = sortTx(txs);
    if (!list.length) return [];
    const start = list[0].date;
    const fxDays = Object.keys(fxh).sort();
    const H = {};
    const qty = {};
    let ti = 0, fi = 0, fxNow = fxh[fxDays[0]] || {};
    const out = [];
    for (let d = start; d <= today; d = addDays(d, 1)) {
      let flow = 0;
      while (ti < list.length && list[ti].date <= d) {
        const x = list[ti++];
        const a = assetsById[x.asset];
        if (!a) continue;
        if (isAcq(x.type)) { qty[x.asset] = (qty[x.asset] || 0) + x.qty; if (x.type === 'buy') flow += x.totalEur || 0; }
        else if (x.type === 'sell') { qty[x.asset] = (qty[x.asset] || 0) - x.qty; flow -= x.totalEur || 0; }
        if (!H[x.asset]) {
          let h = hist(a);
          const days = Object.keys(h.closes).sort();
          const lv = !days.length && live ? live(a) : null;
          if (lv) h = { closes: {}, currency: lv.currency };
          const fallback = lv ? lv.price : (x.price || 0);
          H[x.asset] = { h, days, i: 0, last: days.length ? h.closes[days[0]] : fallback, fallback };
        }
      }
      while (fi < fxDays.length && fxDays[fi] <= d) fxNow = fxh[fxDays[fi++]];
      let v = 0;
      for (const id in qty) {
        const q = qty[id];
        if (q <= EPS) continue;
        const s = H[id];
        while (s.i < s.days.length && s.days[s.i] <= d) s.last = s.h.closes[s.days[s.i++]];
        const px = s.days.length ? s.last : s.fallback;
        const cur = s.h.currency;
        const r = !cur || cur === 'EUR' ? 1 : (fxNow[cur] || 1);
        v += q * px / r;
      }
      out.push({ d, v, flow });
    }
    return out;
  }

  root.Calc = { positions, simulateSale, series, sortTx, addDays, isAcq };
})(window);
