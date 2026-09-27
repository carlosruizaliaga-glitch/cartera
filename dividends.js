// Motor de dividendos: renta prevista, próximos pagos (confirmados / estimados),
// eventos del calendario y dividendos "pendientes de confirmar" que se crean solos.
(function () {
  'use strict';
  const S = window.Store, M = window.Market, C = window.Calc;
  const addDays = (d, n) => C.addDays(d, n);
  const days = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / 86400000);
  const today = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Madrid' });
  const US = ['EEUU', 'Canadá'];

  const settings = () => S.get('settings') || { withholding: {} };
  const whPct = a => { const w = settings().withholding || {}; return a && w[a.country] != null ? +w[a.country] / 100 : 0; };
  const curOf = a => { const q = M.quote(a); return q ? q.currency : a.currency; };

  // Días típicos entre fecha ex-dividendo y pago.
  function payGap(a) {
    const inf = a.yahoo && M.info(a.yahoo);
    if (inf && inf.exDiv && inf.payDate && inf.payDate >= inf.exDiv && days(inf.exDiv, inf.payDate) < 75) return days(inf.exDiv, inf.payDate);
    return US.includes(a.country) ? 21 : 4;
  }

  // Dividendos por acción (fecha ex) que conocemos: diario reciente + mensual largo.
  function perShareHistory(a) {
    // El histórico diario tiene la fecha ex exacta; el mensual (largo) solo se usa para antes.
    const daily = M.dividends(a);
    const hd = M.history(a).closes;
    const dailyStart = Object.keys(hd).sort()[0] || '9999';
    const lh = M.longHistory(a);
    const old = lh ? lh.divs.filter(x => x.d < C.addDays(dailyStart, -20)) : [];
    return old.concat(daily).sort((x, y) => x.d < y.d ? -1 : 1);
  }

  // Dividendo anual por acción (en su divisa): Yahoo (previsto) > últimos 12 meses > el que tú apuntaste.
  function annualPerShare(a) {
    const inf = a.yahoo && M.info(a.yahoo);
    if (inf && inf.divRate > 0) return inf.divRate * (curOf(a) === 'GBP' && inf.currency === 'GBp' ? 0.01 : 1);
    const t = today();
    const ttm = perShareHistory(a).filter(x => x.d > addDays(t, -366)).reduce((s, x) => s + x.amount, 0);
    if (ttm > 0) return ttm;
    return a.divAnnual || 0;
  }
  function frequency(a) {
    const t = today();
    const n = perShareHistory(a).filter(x => x.d > addDays(t, -366)).length;
    return n || (a.divMonths || []).length || 0;
  }
  function lastPerPayment(a) {
    const h = perShareHistory(a);
    if (h.length) return h[h.length - 1].amount;
    const f = frequency(a);
    return f ? annualPerShare(a) / f : 0;
  }

  // Acciones que tenías antes de una fecha (las que cobran el dividendo con ex en esa fecha).
  function qtyBefore(assetId, day) {
    const p = C.positions(S.list('tx').filter(t => t.asset === assetId && t.date < day))[assetId];
    return p ? p.qty : 0;
  }

  // Eventos de un activo: pagos pasados recientes, confirmados y estimados a 12 meses.
  function eventsFor(a, opts) {
    opts = opts || {};
    if (a.type === 'crypto') return [];
    const t = today(), horizon = addDays(t, opts.horizon || 366), from = addDays(t, -(opts.back || 60));
    const inf = a.yahoo && M.info(a.yahoo);
    const gap = payGap(a);
    const cur = curOf(a);
    const hist = perShareHistory(a);
    const per = lastPerPayment(a);
    const out = [];
    const push = (ex, pay, amount, status) => {
      if (!pay || pay < from || pay > horizon) return;
      if (out.some(e => Math.abs(days(e.pay, pay)) < 12)) return;
      out.push({ asset: a, ex, pay, perShare: amount, currency: cur, status });
    };
    // 1) Confirmado por Yahoo (fecha de pago anunciada y/o ex-dividendo próximo)
    if (inf) {
      if (inf.payDate && inf.payDate >= from) {
        const ex = inf.exDiv && inf.exDiv <= inf.payDate && days(inf.exDiv, inf.payDate) < 75 ? inf.exDiv : addDays(inf.payDate, -gap);
        const h = hist.find(x => Math.abs(days(x.d, ex)) < 4);
        push(ex, inf.payDate, h ? h.amount : per, 'confirmed');
      }
      if (inf.exDiv && inf.exDiv > t && !(inf.payDate && inf.payDate >= inf.exDiv)) push(inf.exDiv, addDays(inf.exDiv, gap), per, 'confirmed');
    }
    // 2) Ya declarados (ex pasado) en los últimos días
    hist.filter(x => x.d >= addDays(from, -gap)).forEach(x => push(x.d, addDays(x.d, gap), x.amount, 'declared'));
    // 3) Estimados: repetir el calendario del último año
    const last12 = hist.filter(x => x.d > addDays(t, -366) && x.d <= t);
    if (last12.length) last12.forEach(x => { const ex = addDays(x.d, 365); if (ex > t) push(ex, addDays(ex, gap), per, 'estimated'); });
    else (a.divMonths || []).forEach(m => {
      for (const y of [+t.slice(0, 4), +t.slice(0, 4) + 1]) {
        const pay = `${y}-${String(m).padStart(2, '0')}-15`;
        if (pay > t) { push(addDays(pay, -gap), pay, per, 'estimated'); break; }
      }
    });
    out.sort((x, y) => x.pay < y.pay ? -1 : 1);
    // Importes para tus acciones
    out.forEach(e => {
      e.qty = e.ex <= t ? qtyBefore(a.id, e.ex) : (opts.qty != null ? opts.qty : qtyBefore(a.id, addDays(t, 1)));
      const r = M.rateOn(e.currency, e.pay > t ? t : e.pay) || 1;
      e.gross = e.qty * e.perShare / r;
      e.net = e.gross * (1 - whPct(a));
      e.w = whPct(a);
    });
    return out;
  }

  // ¿Ya está apuntado este pago? (dividendo de esa empresa cerca de la fecha)
  function recorded(a, ev, divs) {
    return divs.some(d => d.asset === a.id && d.date >= addDays(ev.ex, -5) && d.date <= addDays(ev.pay, 45) && Math.abs(days(d.date, ev.pay)) < 40);
  }

  // Crea los "pendientes de confirmar" de pagos ya vencidos que no están apuntados.
  function ensurePending() {
    if (!S.loggedIn()) return 0;
    const t = today();
    const divs = S.list('dividend');
    const pos = C.positions(S.list('tx'));
    let n = 0;
    S.list('asset').forEach(a => {
      if (a.type === 'crypto') return;
      const p = pos[a.id];
      if (!p || !p.txs.length) return;
      eventsFor(a, { back: 45, horizon: 1 }).forEach(ev => {
        if (ev.pay >= t || ev.status === 'estimated' || ev.qty <= 0) return;
        const id = 'd-auto-' + a.id + '-' + ev.ex;
        if (S.has(id) || recorded(a, ev, divs)) return;
        S.put('dividend', {
          id, asset: a.id, type: 'dividend', date: ev.pay, ex: ev.ex,
          gross: Math.round(ev.gross * 100) / 100, withholding: Math.round((ev.gross - ev.net) * 100) / 100, withholdingEs: 0, fee: 0,
          net: Math.round(ev.net * 100) / 100, currency: 'EUR', fx: 1, broker: (p.txs[p.txs.length - 1] || {}).broker || 'b-degiro',
          status: 'pending', netImported: false, qty: ev.qty, perShare: ev.perShare, perShareCurrency: ev.currency
        });
        n++;
      });
    });
    return n;
  }

  // Resumen de renta: previsto 12 meses (bruto/neto) y por empresa.
  function forecast(rows) {
    let gross = 0, net = 0, value = 0, cost = 0;
    const by = [];
    rows.forEach(r => {
      const a = r.a;
      if (a.type === 'crypto') return;
      value += r.value || 0; cost += r.p.costEur;
      const ann = annualPerShare(a);
      const rate = M.rate(curOf(a)) || 1;
      const g = r.p.qty * ann / rate, n = g * (1 - whPct(a));
      gross += g; net += n;
      if (g > 0) by.push({ a, gross: g, net: n, yld: r.value ? g / r.value : 0, yoc: r.p.costEur ? g / r.p.costEur : 0 });
    });
    by.sort((x, y) => y.net - x.net);
    return { gross, net, monthly: net / 12, yld: value ? gross / value : 0, yoc: cost ? gross / cost : 0, by, value, cost };
  }

  // Todos los eventos futuros (y los últimos días) de tus posiciones (y opcionalmente la watchlist).
  function upcoming(assets, opts) {
    const all = [];
    assets.forEach(a => eventsFor(a, opts).forEach(e => all.push(e)));
    return all.sort((x, y) => x.pay < y.pay ? -1 : 1);
  }

  window.Divs = { eventsFor, ensurePending, forecast, upcoming, annualPerShare, frequency, perShareHistory, lastPerPayment, whPct, payGap };
})();
