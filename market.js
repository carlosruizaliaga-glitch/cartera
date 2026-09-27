// Datos de mercado: pide a la Edge Function "ct-market" y guarda una copia en el móvil
// para enseñar el último precio (con su hora) si no hay conexión o una fuente falla.
(function (root) {
  'use strict';
  const S = root.Store;
  const LS = 'cartera.market.v1';
  const QUOTE_AGE = 15 * 60 * 1000, HIST_AGE = 12 * 3600 * 1000;

  let m = { quotes: {}, fx: null, info: {}, history: {}, lastQuotes: 0, lastHistory: 0, errors: [] };
  try { Object.assign(m, JSON.parse(localStorage.getItem(LS) || '{}')); } catch (e) { console.error(e); }
  const listeners = [];
  let busy = false, lastError = null, ver = 0;

  function persist() {
    ver++;
    try { localStorage.setItem(LS, JSON.stringify(m)); }
    catch (e) { // si no cabe, sacrificamos los históricos (se vuelven a pedir)
      try { localStorage.setItem(LS, JSON.stringify(Object.assign({}, m, { history: {}, lastHistory: 0 }))); } catch (e2) { console.error(e2); }
    }
  }
  const emit = () => listeners.forEach(f => { try { f(); } catch (e) { console.error(e); } });

  // Claves de cotización / histórico de un activo.
  function quoteKey(a) {
    if (a.type === 'crypto') return a.coingecko ? 'C:' + a.coingecko : null;
    return a.yahoo ? 'Y:' + a.yahoo : null;
  }
  // Histórico cripto: Yahoo (años) cuando lo tiene; si no, CoinGecko (solo 365 días en el plan gratuito).
  const YAHOO_CRYPTO = { PEPE: null, BGB: null };
  function histKeys(a) {
    if (a.type === 'crypto') {
      const y = a.ticker in YAHOO_CRYPTO ? YAHOO_CRYPTO[a.ticker] : a.ticker + '-EUR';
      return y ? ['Y:' + y] : (a.coingecko ? ['C:' + a.coingecko] : []);
    }
    return a.yahoo ? ['Y:' + a.yahoo] : [];
  }

  async function call(body) {
    const res = await fetch(S.BASE + '/functions/v1/ct-market', {
      method: 'POST',
      headers: { apikey: S.KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify(Object.assign({ secret: S.secret() }, body))
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.error) throw new Error(data.error || ('HTTP ' + res.status));
    return data;
  }

  // assets: activos cuyo precio queremos; histAssets: activos con operaciones (para el gráfico).
  async function refresh({ assets, histAssets, from, force, info }) {
    if (!S.secret() || busy) return;
    const now = Date.now();
    const needQuotes = force || now - (m.lastQuotes || 0) > QUOTE_AGE;
    const needHist = histAssets && (force === 'all' || now - (m.lastHistory || 0) > HIST_AGE || !Object.keys(m.history || {}).length);
    if (!needQuotes && !needHist && !(info && info.length)) return;
    busy = true; emit();
    try {
      const body = { force: !!force, fx: true, quotes: [], history: [], info: info || [] };
      if (needQuotes) body.quotes = [...new Set(assets.map(quoteKey).filter(Boolean))];
      if (needHist) { body.history = [...new Set(histAssets.flatMap(histKeys))].concat('FX'); body.from = from; }
      const d = await call(body);
      Object.assign(m.quotes, d.quotes || {});
      if (d.fx) m.fx = d.fx;
      Object.assign(m.info, d.info || {});
      if (needHist && d.history) { m.history = Object.assign(m.history || {}, d.history); m.lastHistory = now; }
      if (needQuotes) m.lastQuotes = now;
      m.errors = d.errors || [];
      lastError = null;
      persist();
    } catch (e) {
      console.warn('market', e);
      lastError = navigator.onLine ? String(e.message || e) : 'sin conexión';
    } finally { busy = false; emit(); }
  }

  // Precio actual en la divisa de la fuente (los peniques de Londres pasan a libras).
  function quote(a) {
    const q = m.quotes[quoteKey(a)];
    if (!q || q.price == null) return null;
    const pence = q.currency === 'GBp' || q.currency === 'GBX';
    const k = pence ? 0.01 : 1;
    return { price: q.price * k, prev: q.prev != null ? q.prev * k : null, currency: pence ? 'GBP' : (q.currency || a.currency),
      ts: q.ts || q.time, time: q.time, image: q.image, name: q.name, high52: q.high52 != null ? q.high52 * k : null, low52: q.low52 != null ? q.low52 * k : null };
  }
  // Euros por cada unidad de divisa: EUR/ tipo BCE (1 EUR = rate unidades).
  function rate(cur) {
    if (!cur || cur === 'EUR') return 1;
    return (m.fx && m.fx.rates && m.fx.rates[cur]) || null;
  }
  // Cierres diarios de un activo en su divisa de origen: { closes: {día: precio}, currency }.
  function history(a) {
    const keys = histKeys(a);
    let closes = {}, currency = a.type === 'crypto' ? 'EUR' : a.currency;
    // Primero CoinGecko (365 días) y encima Yahoo (más largo) cuando existe.
    keys.slice().reverse().forEach(k => {
      const h = m.history && m.history[k];
      if (!h || !h.closes) return;
      Object.assign(closes, h.closes);
      if (h.events && h.events.currency) currency = h.events.currency;
    });
    if (currency === 'GBp' || currency === 'GBX') {
      const c2 = {}; Object.keys(closes).forEach(d => { c2[d] = closes[d] / 100; }); closes = c2; currency = 'GBP';
    }
    return { closes, currency };
  }
  const fxHistory = () => (m.history && m.history.FX && m.history.FX.closes) || {};

  // Tipo BCE de una fecha (último publicado en o antes de ese día); si no hay histórico, el último.
  function rateOn(cur, day) {
    if (!cur || cur === 'EUR') return 1;
    const h = fxHistory();
    if (day && day < (m.fx && m.fx.date || '9999')) {
      const days = Object.keys(h).filter(d => d <= day).sort();
      for (let i = days.length - 1; i >= 0; i--) if (h[days[i]][cur]) return h[days[i]][cur];
    }
    return rate(cur);
  }

  // Dividendos por acción cobrados según Yahoo: [{ d, amount }] (en la divisa de cotización).
  function dividends(a) {
    const keys = histKeys(a);
    const out = [];
    keys.forEach(k => {
      const h = m.history && m.history[k];
      const dv = (h && h.events && h.events.divs) || {};
      const k100 = h && h.events && (h.events.currency === 'GBp' || h.events.currency === 'GBX') ? 0.01 : 1;
      Object.keys(dv).forEach(d => out.push({ d, amount: dv[d] * k100 }));
    });
    return out.sort((x, y) => x.d < y.d ? -1 : 1);
  }

  // Carga precio + ficha + histórico de unos activos concretos (formularios, ficha, empresa nueva).
  async function load(assets, opts) {
    opts = opts || {};
    const body = { quotes: [...new Set(assets.map(quoteKey).filter(Boolean))], force: !!opts.force, fx: true };
    if (opts.info) body.info = assets.filter(a => a.type !== 'crypto' && a.yahoo).map(a => a.yahoo);
    if (opts.history) { body.history = [...new Set(assets.flatMap(histKeys))]; body.from = opts.from || '2023-01-01'; }
    const d = await call(body);
    Object.assign(m.quotes, d.quotes || {});
    if (d.fx) m.fx = d.fx;
    Object.assign(m.info, d.info || {});
    if (d.history) m.history = Object.assign(m.history || {}, d.history);
    persist(); emit();
    return d;
  }
  async function search(q, kind) {
    const d = await call({ search: { q, kind } });
    return d.results || [];
  }

  root.Market = {
    onChange: f => listeners.push(f),
    refresh, quote, rate, rateOn, history, fxHistory, quoteKey, dividends, load, search,
    info: sym => m.info[sym] || null,
    busy: () => busy,
    version: () => ver,
    error: () => lastError,
    errors: () => m.errors || [],
    lastQuotes: () => m.lastQuotes || 0,
    fxDate: () => m.fx && m.fx.date
  };
})(window);
