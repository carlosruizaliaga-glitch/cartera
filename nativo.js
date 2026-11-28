// App de Android: manda el resumen al widget y los próximos eventos y alertas a los avisos.
// Solo hace algo dentro del envoltorio nativo (window.AndroidBridge).
(function () {
  'use strict';
  const S = window.Store, M = window.Market, C = window.Calc, UI = new Proxy({}, { get: (_, k) => window.UI[k] });
  // ---------- App de Android: resumen para el widget y eventos para los avisos ----------
  let nativeTimer = null;
  function scheduleNative() { clearTimeout(nativeTimer); nativeTimer = setTimeout(pushNative, 1500); }
  function pushNative() {
    const B = window.AndroidBridge;
    if (!B || !S.loggedIn()) return;
    try { if (window.SettingsScreen && window.SettingsScreen.autoBackup) window.SettingsScreen.autoBackup(); } catch (e) { console.warn('autobackup', e); }
    try {
      const mdl = UI.model();
      if (!mdl.rows.length) return;
      const rows = mdl.rows, t = UI.today();
      const total = rows.reduce((x, r) => x + (r.value || 0), 0);
      const day = rows.reduce((x, r) => x + (r.day || 0), 0);
      const dayPct = total - day ? day / (total - day) : 0;
      const stocks = rows.filter(r => r.a.type !== 'crypto').map(r => r.a);
      const evs = window.Divs.upcoming(stocks, { back: 0 }).filter(e => e.pay >= t && e.qty > 0);
      const dd = iso => iso.slice(8, 10) + '/' + iso.slice(5, 7);
      const next = evs[0];
      // Con el modo privado activado, UI.eur() ya devuelve "••••": el widget y los avisos no enseñan importes.
      B.saveSummary(JSON.stringify({ v: UI.eur(total), d: UI.sEur(day) + ' (' + UI.sPct(dayPct) + ')', up: day > 1e-9 ? 1 : day < -1e-9 ? -1 : 0,
        n: next ? next.asset.ticker + ' · ' + dd(next.pay) + ' · ~' + UI.eur(next.net) : '', t: Date.now() }));
      const out = [], limit = C.addDays(t, 60);
      evs.forEach(e => {
        out.push({ t: e.asset.ticker, k: 'pay', d: e.pay, a: UI.eur(e.net) });
        if (e.ex && e.ex >= t) out.push({ t: e.asset.ticker, k: 'ex', d: e.ex });
      });
      stocks.forEach(a => {
        const inf = a.yahoo && M.info(a.yahoo);
        ((inf && inf.earnings) || []).forEach(d => { if (d >= t) out.push({ t: a.ticker, k: 'earn', d }); });
      });
      try { if (window.Plan && window.Plan.alertEvents) out.push(...window.Plan.alertEvents(rows, total)); } catch (e) { /* sin alertas */ }
      B.saveEvents(JSON.stringify(out.filter(e => e.d <= limit)));
    } catch (e) { console.warn('native', e); }
  }
  window.Nativo = { schedule: scheduleNative };
})();
