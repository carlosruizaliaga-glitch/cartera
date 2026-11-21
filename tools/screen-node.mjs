const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128 Safari/537.36';

async function getJson(url, headers={}){const r=await fetch(url,{headers:{'User-Agent':UA,Accept:'application/json',...headers}});if(!r.ok)throw new Error(r.status+' '+url.split('?')[0]);return await r.json();}
let crumb=null;
async function yahooCrumb(){if(crumb)return crumb;const r=await fetch('https://fc.yahoo.com',{headers:{'User-Agent':UA},redirect:'manual'});const cookie=(r.headers.get('set-cookie')||'').split(';')[0];const c=await(await fetch('https://query1.finance.yahoo.com/v1/test/getcrumb',{headers:{'User-Agent':UA,Cookie:cookie}})).text();crumb={c,cookie};return crumb;}
const raw = (o) => (o && typeof o === 'object' ? o.raw ?? null : o ?? null);
const isoYear = (unixSec) => new Date(unixSec * 1000).getUTCFullYear();

async function screen(sym) {
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
  const closes = (res?.indicators?.quote?.[0]?.close || []).filter((x) => x != null);
  const divs = Object.values(res?.events?.dividends || {}) ;

  // Dividendo anual por año (años completos) y racha de años pagando / sin recortes
  const byYear = {};
  for (const d of divs) { const y = isoYear(d.date); byYear[y] = (byYear[y] || 0) + d.amount; }
  const thisYear = new Date().getUTCFullYear();
  const years = Object.keys(byYear).map(Number).filter((y) => y < thisYear).sort((a, b) => a - b);
  let streak = 0;
  for (let i = years.length - 1; i >= 0; i--) { if (i === years.length - 1 || years[i] === years[i + 1] - 1) streak++; else break; }
  let cuts = 0;
  for (let i = 1; i < years.length; i++) if (years[i] === years[i - 1] + 1 && byYear[years[i]] < byYear[years[i - 1]] * 0.9) cuts++;
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


const syms=process.argv.slice(2);const out={};
for(const s of syms){try{out[s]=await screen(s);}catch(e){console.error(s,String(e).slice(0,120));}}
console.log(JSON.stringify(out));
