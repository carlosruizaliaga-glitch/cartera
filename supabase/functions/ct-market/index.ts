// Edge Function "ct-market": única puerta a los datos de mercado.
// Comprueba el código de la app, consulta Yahoo / CoinGecko / Frankfurter (BCE)
// y guarda una caché en ct_prices / ct_history. Si una fuente falla, devuelve lo último guardado.
import { createClient } from 'jsr:@supabase/supabase-js@2';

const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128 Safari/537.36';
const MIN = 60_000, HOUR = 3_600_000;
const QUOTE_TTL = 15 * MIN, FORCE_TTL = 1 * MIN, HIST_TTL = 12 * HOUR, INFO_TTL = 12 * HOUR;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

async function getJson(url: string, headers: Record<string, string> = {}) {
  const r = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json', ...headers } });
  if (!r.ok) throw new Error(`${r.status} ${url.split('?')[0]}`);
  return await r.json();
}

// Ejecuta tareas con un máximo de n a la vez.
async function pool<T>(items: T[], n: number, fn: (x: T) => Promise<void>) {
  const q = [...items];
  await Promise.all(Array.from({ length: Math.min(n, q.length) }, async () => {
    while (q.length) await fn(q.shift()!);
  }));
}

const isoDay = (unixSec: number, offsetSec = 0) => new Date((unixSec + offsetSec) * 1000).toISOString().slice(0, 10);

// ---------- Yahoo ----------
async function yahooQuote(sym: string) {
  const d = await getJson(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?range=1d&interval=1d`);
  const m = d?.chart?.result?.[0]?.meta;
  if (!m || m.regularMarketPrice == null) throw new Error('sin precio ' + sym);
  return {
    price: m.regularMarketPrice, prev: m.chartPreviousClose ?? m.previousClose ?? null, currency: m.currency,
    high52: m.fiftyTwoWeekHigh ?? null, low52: m.fiftyTwoWeekLow ?? null,
    name: m.longName || m.shortName || null, time: m.regularMarketTime ? m.regularMarketTime * 1000 : Date.now(),
  };
}

async function yahooHistory(sym: string, fromIso: string) {
  const p1 = Math.floor(new Date(fromIso + 'T00:00:00Z').getTime() / 1000);
  const p2 = Math.floor(Date.now() / 1000) + 86400;
  const d = await getJson(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?period1=${p1}&period2=${p2}&interval=1d&events=div,split`);
  const r = d?.chart?.result?.[0];
  if (!r?.timestamp) throw new Error('sin histórico ' + sym);
  const off = r.meta?.gmtoffset || 0;
  const closes: Record<string, number> = {};
  const q = r.indicators?.quote?.[0]?.close || [];
  r.timestamp.forEach((t: number, i: number) => { if (q[i] != null) closes[isoDay(t, off)] = q[i]; });
  // Yahoo ajusta los cierres por splits: los "desajustamos" para que cuadren con las acciones que tenías.
  const splits = Object.values(r.events?.splits || {}) as any[];
  for (const s of splits) {
    const day = isoDay(s.date, off), ratio = s.numerator / s.denominator;
    for (const k of Object.keys(closes)) if (k < day) closes[k] *= ratio;
  }
  const divs: Record<string, number> = {};
  for (const v of Object.values(r.events?.dividends || {}) as any[]) divs[isoDay(v.date, off)] = v.amount;
  const splitMap: Record<string, number> = {};
  for (const s of splits) splitMap[isoDay(s.date, off)] = s.numerator / s.denominator;
  return { closes, events: { divs, splits: splitMap, currency: r.meta?.currency } };
}

// Histórico largo mensual (gráfico de 5 años / máximo y dividendos de siempre).
async function yahooMonthly(sym: string) {
  const d = await getJson(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?range=max&interval=1mo&events=div,split`);
  const r = d?.chart?.result?.[0];
  if (!r?.timestamp) throw new Error('sin histórico largo ' + sym);
  const off = r.meta?.gmtoffset || 0;
  const closes: Record<string, number> = {};
  const q = r.indicators?.quote?.[0]?.close || [];
  r.timestamp.forEach((t: number, i: number) => { if (q[i] != null) closes[isoDay(t, off)] = q[i]; });
  const divs: Record<string, number> = {};
  for (const v of Object.values(r.events?.dividends || {}) as any[]) divs[isoDay(v.date, off)] = v.amount;
  return { closes, events: { divs, currency: r.meta?.currency, monthly: true } };
}

let crumb: { c: string; cookie: string } | null = null;
async function yahooCrumb() {
  if (crumb) return crumb;
  const r = await fetch('https://fc.yahoo.com', { headers: { 'User-Agent': UA }, redirect: 'manual' });
  const cookie = (r.headers.get('set-cookie') || '').split(';')[0];
  const c = await (await fetch('https://query1.finance.yahoo.com/v1/test/getcrumb', { headers: { 'User-Agent': UA, Cookie: cookie } })).text();
  if (!c || c.includes('<')) throw new Error('sin crumb');
  crumb = { c, cookie };
  return crumb;
}

async function yahooInfo(sym: string) {
  const k = await yahooCrumb();
  const d = await getJson(`https://query1.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(sym)}?modules=summaryDetail,defaultKeyStatistics,calendarEvents,assetProfile,price&crumb=${encodeURIComponent(k.c)}`,
    { Cookie: k.cookie });
  const r = d?.quoteSummary?.result?.[0];
  if (!r) throw new Error('sin ficha ' + sym);
  const raw = (o: any) => (o && typeof o === 'object' ? o.raw ?? null : o ?? null);
  const sd = r.summaryDetail || {}, ks = r.defaultKeyStatistics || {}, ce = r.calendarEvents || {}, ap = r.assetProfile || {}, pr = r.price || {};
  const ts = (v: any) => (raw(v) ? isoDay(raw(v)) : null);
  return {
    name: pr.longName || pr.shortName || null, currency: pr.currency || null, exchange: pr.exchangeName || null,
    pe: raw(sd.trailingPE), eps: raw(ks.trailingEps), marketCap: raw(sd.marketCap) ?? raw(pr.marketCap),
    high52: raw(sd.fiftyTwoWeekHigh), low52: raw(sd.fiftyTwoWeekLow),
    divRate: raw(sd.dividendRate) ?? raw(sd.trailingAnnualDividendRate), divYield: raw(sd.dividendYield),
    exDiv: ts(ce.exDividendDate) || ts(sd.exDividendDate), payDate: ts(ce.dividendDate),
    earnings: (ce.earnings?.earningsDate || []).map((e: any) => isoDay(e.raw)),
    earningsEstimate: !!ce.earnings?.isEarningsDateEstimate,
    sector: ap.sector || null, industry: ap.industry || null, country: ap.country || null, website: ap.website || null,
  };
}

// ---------- CoinGecko ----------
async function coinQuotes(ids: string[]) {
  const d = await getJson(`https://api.coingecko.com/api/v3/coins/markets?vs_currency=eur&ids=${ids.join(',')}&per_page=250`);
  const out: Record<string, unknown> = {};
  for (const c of d) {
    const chg = c.price_change_percentage_24h;
    out[c.id] = {
      price: c.current_price, prev: chg != null ? c.current_price / (1 + chg / 100) : null, currency: 'EUR',
      name: c.name, image: c.image, high52: null, low52: null,
      time: c.last_updated ? Date.parse(c.last_updated) : Date.now(),
    };
  }
  return out;
}

async function coinHistory(id: string) {
  const d = await getJson(`https://api.coingecko.com/api/v3/coins/${id}/market_chart?vs_currency=eur&days=365&interval=daily`);
  const closes: Record<string, number> = {};
  for (const [t, p] of d.prices || []) closes[isoDay(Math.floor(t / 1000))] = p;
  return { closes, events: {} };
}

// ---------- Búsqueda (empresa nueva) ----------
async function searchStocks(q: string) {
  const d = await getJson(`https://query1.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(q)}&quotesCount=10&newsCount=0`);
  return (d.quotes || []).filter((x: any) => x.symbol && ['EQUITY', 'ETF'].includes(x.quoteType))
    .map((x: any) => ({ symbol: x.symbol, name: x.longname || x.shortname || x.symbol, exchange: x.exchange, type: x.quoteType }));
}
async function searchCoins(q: string) {
  const d = await getJson(`https://api.coingecko.com/api/v3/search?query=${encodeURIComponent(q)}`);
  return (d.coins || []).slice(0, 8).map((c: any) => ({ id: c.id, symbol: (c.symbol || '').toUpperCase(), name: c.name, image: c.large || c.thumb }));
}

// ---------- BCE (Frankfurter) ----------
async function fxLatest() {
  const d = await getJson('https://api.frankfurter.dev/v1/latest?base=EUR');
  return { rates: d.rates, date: d.date, price: 1, currency: 'EUR', time: Date.now() };
}
async function fxHistory(fromIso: string) {
  const d = await getJson(`https://api.frankfurter.dev/v1/${fromIso}..?base=EUR&symbols=USD,CHF,GBP,HKD,CAD,DKK,SEK,NOK,JPY`);
  return { closes: d.rates as Record<string, Record<string, number>>, events: {} };
}

// ---------- Principal ----------
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  try {
    const body = await req.json().catch(() => ({}));
    const { data: ok, error } = await sb.rpc('ct_check', { p_secret: body.secret ?? '' });
    if (error) return json({ error: String(error.message || error) }, 429);
    if (!ok) return json({ error: 'bad_secret' }, 401);

    if (body.search && typeof body.search.q === 'string') {
      const q = body.search.q.slice(0, 40);
      try {
        return json({ results: body.search.kind === 'crypto' ? await searchCoins(q) : await searchStocks(q) });
      } catch (e) { return json({ results: [], errors: [String(e)] }); }
    }

    const now = Date.now();
    const ttl = body.force ? FORCE_TTL : QUOTE_TTL;
    const quoteKeys: string[] = (body.quotes || []).slice(0, 400);
    const infoKeys: string[] = (body.info || []).slice(0, 60).map((s: string) => 'I:' + s);
    const histKeys: string[] = (body.history || []).slice(0, 120);
    const from: string = /^\d{4}-\d{2}-\d{2}$/.test(body.from || '') ? body.from : '2023-01-01';
    const errors: string[] = [];

    // Caché actual
    const wanted = [...quoteKeys, ...infoKeys, 'FX:latest'];
    const { data: rows } = await sb.from('ct_prices').select('symbol,data,fetched_at').in('symbol', wanted);
    const cache: Record<string, any> = {};
    for (const r of rows || []) cache[r.symbol] = { ...r.data, ts: Date.parse(r.fetched_at) };
    const stale = (k: string, t: number) => !cache[k] || now - cache[k].ts > t;
    const fresh: { symbol: string; data: unknown; source: string; fetched_at: string }[] = [];
    const save = (symbol: string, data: any, source: string) => {
      cache[symbol] = { ...data, ts: now };
      fresh.push({ symbol, data, source, fetched_at: new Date(now).toISOString() });
    };

    // Cotizaciones
    const ys = quoteKeys.filter((k) => k.startsWith('Y:') && stale(k, ttl));
    const cs = quoteKeys.filter((k) => k.startsWith('C:') && stale(k, ttl));
    await pool(ys, 8, async (k) => {
      try { save(k, await yahooQuote(k.slice(2)), 'yahoo'); } catch (e) { errors.push(String(e)); }
    });
    if (cs.length) {
      try {
        const q = await coinQuotes(cs.map((k) => k.slice(2)));
        for (const k of cs) if (q[k.slice(2)]) save(k, q[k.slice(2)], 'coingecko');
      } catch (e) { errors.push(String(e)); }
    }
    if (body.fx !== false && stale('FX:latest', ttl)) {
      try { save('FX:latest', await fxLatest(), 'bce'); } catch (e) { errors.push(String(e)); }
    }
    // Fichas (PER, BPA, eventos…)
    await pool(infoKeys.filter((k) => stale(k, INFO_TTL)), 4, async (k) => {
      try { save(k, await yahooInfo(k.slice(2)), 'yahoo'); } catch (e) { errors.push(String(e)); }
    });
    if (fresh.length) await sb.from('ct_prices').upsert(fresh);

    // Históricos (incrementales)
    const history: Record<string, unknown> = {};
    if (histKeys.length) {
      const { data: hrows } = await sb.from('ct_history').select('symbol,closes,events,fetched_at').in('symbol', histKeys);
      const hc: Record<string, any> = {};
      for (const r of hrows || []) hc[r.symbol] = r;
      const upd: unknown[] = [];
      // CoinGecko limita las peticiones seguidas: sus históricos van de uno en uno.
      const cgKeys = histKeys.filter((k) => k.startsWith('C:'));
      const doHist = async (k: string) => {
        const old = hc[k];
        if (old && now - Date.parse(old.fetched_at) < HIST_TTL) { history[k] = { closes: old.closes, events: old.events }; return; }
        const days = old ? Object.keys(old.closes).sort() : [];
        // Con splits hay que recargar entero; si no, solo desde la última fecha guardada.
        const since = days.length ? new Date(Date.parse(days[days.length - 1]) - 7 * 86400000).toISOString().slice(0, 10) : from;
        try {
          let h: { closes: Record<string, any>; events: any };
          if (k === 'FX') h = await fxHistory(since);
          else if (k.startsWith('D:')) { const mh = await yahooMonthly(k.slice(2)); history[k] = mh; upd.push({ symbol: k, closes: mh.closes, events: mh.events, fetched_at: new Date(now).toISOString() }); return; }
          else if (k.startsWith('C:')) h = await coinHistory(k.slice(2));
          else {
            h = await yahooHistory(k.slice(2), since);
            if (old && Object.keys(h.events.splits || {}).some((d: string) => d >= since)) h = await yahooHistory(k.slice(2), from);
            else if (old) h.events = { ...old.events, ...h.events, divs: { ...(old.events?.divs || {}), ...h.events.divs }, splits: { ...(old.events?.splits || {}), ...h.events.splits } };
          }
          const closes = { ...(old?.closes || {}), ...h.closes };
          history[k] = { closes, events: h.events };
          upd.push({ symbol: k, closes, events: h.events, fetched_at: new Date(now).toISOString() });
        } catch (e) {
          errors.push(String(e));
          if (old) history[k] = { closes: old.closes, events: old.events };
        }
      };
      await pool(histKeys.filter((k) => !k.startsWith('C:')), 6, doHist);
      await pool(cgKeys, 1, doHist);
      if (upd.length) await sb.from('ct_history').upsert(upd);
    }

    const pick = (keys: string[]) => Object.fromEntries(keys.filter((k) => cache[k]).map((k) => [k, cache[k]]));
    return json({
      quotes: pick(quoteKeys), fx: cache['FX:latest'] || null,
      info: Object.fromEntries(infoKeys.filter((k) => cache[k]).map((k) => [k.slice(2), cache[k]])),
      history, errors, now,
    });
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});
