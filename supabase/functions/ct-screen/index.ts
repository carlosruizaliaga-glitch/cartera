// Edge Function "ct-screen": ficha de calidad y valoración de empresas candidatas (para las sugerencias de la app).
// Comprueba el código de la app (igual que ct-market), consulta Yahoo Finance y guarda el resultado 12 h en ct_prices (clave "S:<símbolo>").
import { createClient } from 'jsr:@supabase/supabase-js@2';

const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128 Safari/537.36';
const TTL = 12 * 3600_000;
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

async function getJson(url: string, headers: Record<string, string> = {}) {
  const r = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json', ...headers } });
  if (!r.ok) throw new Error(`${r.status} ${url.split('?')[0]}`);
  return await r.json();
}
async function pool<T>(items: T[], n: number, fn: (x: T) => Promise<void>) {
  const q = [...items];
  await Promise.all(Array.from({ length: Math.min(n, q.length) }, async () => { while (q.length) await fn(q.shift()!); }));
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

const raw = (o: any) => (o && typeof o === 'object' ? o.raw ?? null : o ?? null);
const isoYear = (unixSec: number) => new Date(unixSec * 1000).getUTCFullYear();

async function screen(sym: string) {
  const k = await yahooCrumb();
  const mods = 'summaryDetail,defaultKeyStatistics,financialData,assetProfile,price';
  const [sumRes, chart] = await Promise.all([
    getJson(`https://query1.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(sym)}?modules=${mods}&crumb=${encodeURIComponent(k.c)}`, { Cookie: k.cookie }),
    getJson(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?range=10y&interval=1mo&events=div`),
  ]);
  const r = sumRes?.quoteSummary?.result?.[0];
  if (!r) throw new Error('sin ficha ' + sym);
  const sd = r.summaryDetail || {}, ks = r.defaultKeyStatistics || {}, fd = r.financialData || {}, ap = r.assetProfile || {}, pr = r.price || {};
  const res = chart?.chart?.result?.[0];
  const closes: number[] = (res?.indicators?.quote?.[0]?.close || []).filter((x: any) => x != null);
  const divs = Object.values(res?.events?.dividends || {}) as any[];

  // Dividendo anual por año (años completos) y racha de años pagando / sin recortes
  const byYear: Record<number, number> = {}, cnt: Record<number, number> = {};
  for (const d of divs) { const y = isoYear(d.date); byYear[y] = (byYear[y] || 0) + d.amount; cnt[y] = (cnt[y] || 0) + 1; }
  const thisYear = new Date().getUTCFullYear();
  const years = Object.keys(byYear).map(Number).filter((y) => y < thisYear).sort((a, b) => a - b);
  let streak = 0;
  for (let i = years.length - 1; i >= 0; i--) { if (i === years.length - 1 || years[i] === years[i + 1] - 1) streak++; else break; }
  let cuts = 0;
  // Recorte = el año suma >15 % menos que el anterior con el mismo número de pagos (así no cuenta un pago que cae en otro año). El primer año puede estar incompleto: no se usa de base.
  for (let i = 2; i < years.length; i++) if (years[i] === years[i - 1] + 1 && cnt[years[i]] >= cnt[years[i - 1]] && byYear[years[i]] < byYear[years[i - 1]] * 0.85) cuts++;
  const first = years[0], last = years[years.length - 1];
  const span = years.length >= 6 ? Math.min(5, last - first) : 0;
  const cagr5 = span >= 3 && byYear[years[years.length - 1 - span]] > 0 ? Math.pow(byYear[last] / byYear[years[years.length - 1 - span]], 1 / span) - 1 : null;

  // Precio frente a su histórico de 5 años (cierres mensuales)
  const c5 = closes.slice(-60);
  const price = raw(pr.regularMarketPrice) ?? raw(sd.previousClose) ?? closes[closes.length - 1] ?? null;
  const avg5 = c5.length >= 24 ? c5.reduce((a, b) => a + b, 0) / c5.length : null;
  const lo5 = c5.length >= 24 ? Math.min(...c5) : null, hi5 = c5.length >= 24 ? Math.max(...c5) : null;
  const pctile5 = lo5 != null && hi5 != null && hi5 > lo5 && price != null ? (price - lo5) / (hi5 - lo5) : null;

  const shares = raw(ks.sharesOutstanding), fcf = raw(fd.freeCashflow), rate = raw(sd.dividendRate) ?? raw(sd.trailingAnnualDividendRate);
  const debt = raw(fd.totalDebt), cash = raw(fd.totalCash), ebitda = raw(fd.ebitda);
  return {
    sym, name: pr.longName || pr.shortName || sym, currency: pr.currency || null, exchange: pr.exchangeName || null,
    sector: ap.sector || null, industry: ap.industry || null, country: ap.country || null,
    price, marketCap: raw(sd.marketCap) ?? raw(pr.marketCap), high52: raw(sd.fiftyTwoWeekHigh), low52: raw(sd.fiftyTwoWeekLow),
    divRate: rate, divYield: raw(sd.dividendYield), yield5: raw(sd.fiveYearAvgDividendYield) != null ? raw(sd.fiveYearAvgDividendYield) / 100 : null,
    payout: raw(sd.payoutRatio), fcfPayout: fcf && fcf > 0 && rate && shares ? (rate * shares) / fcf : null,
    pe: raw(sd.trailingPE), fwdPe: raw(sd.forwardPE) ?? (raw(ks.forwardEps) && price ? price / raw(ks.forwardEps) : null),
    debtToEquity: raw(fd.debtToEquity), currentRatio: raw(fd.currentRatio),
    netDebtEbitda: debt != null && ebitda && ebitda > 0 ? ((debt - (cash || 0)) / ebitda) : null,
    margin: raw(fd.profitMargins), roe: raw(fd.returnOnEquity), earningsGrowth: raw(fd.earningsGrowth), revenueGrowth: raw(fd.revenueGrowth),
    target: raw(fd.targetMeanPrice), analysts: raw(fd.numberOfAnalystOpinions), reco: raw(fd.recommendationMean),
    avg5, pctile5, streak, cuts, cagr5, divYears: years.length,
  };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  try {
    const body = await req.json().catch(() => ({}));
    const ip = (req.headers.get('x-forwarded-for') || req.headers.get('cf-connecting-ip') || '').split(',')[0].trim() || 'edge';
    const { data: ok, error } = await sb.rpc('ct_check', { p_secret: body.secret ?? '', p_ip: ip });
    if (error) return json({ error: String(error.message || error) }, 429);
    if (!ok) return json({ error: 'bad_secret' }, 401);

    const syms: string[] = (Array.isArray(body.symbols) ? body.symbols : []).filter((s: unknown) => typeof s === 'string' && /^[A-Za-z0-9.\-^=]{1,15}$/.test(s as string)).slice(0, 24);
    if (!syms.length) return json({ items: {}, errors: [] });
    const now = Date.now();
    const keys = syms.map((s) => 'S:' + s);
    const { data: rows } = await sb.from('ct_prices').select('symbol,data,fetched_at').in('symbol', keys);
    const items: Record<string, any> = {}, errors: string[] = [];
    const fresh: { symbol: string; data: unknown; source: string; fetched_at: string }[] = [];
    for (const r of rows || []) if (!body.force && now - Date.parse(r.fetched_at) < TTL) items[r.symbol.slice(2)] = r.data;
    await pool(syms.filter((s) => !items[s]), 4, async (s) => {
      try { const d = await screen(s); items[s] = d; fresh.push({ symbol: 'S:' + s, data: d, source: 'yahoo', fetched_at: new Date(now).toISOString() }); }
      catch (e) { errors.push(`${s}: ${String(e)}`); const old = (rows || []).find((r) => r.symbol === 'S:' + s); if (old) items[s] = old.data; }
    });
    if (fresh.length) await sb.from('ct_prices').upsert(fresh);
    return json({ items, errors, now });
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});
