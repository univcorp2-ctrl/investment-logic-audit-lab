import { enrichChartBars, normalizeStockCode, parseNewsRss } from '../../stock-detail-core.js';

const FETCH_TIMEOUT_MS = 4000;
const CACHE_CONTROL = 'public, max-age=120, s-maxage=300, stale-while-revalidate=900';

async function fetchWithTimeout(url, init = {}, timeoutMs = FETCH_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort('timeout'), timeoutMs);
  try { return await fetch(url, { ...init, signal:controller.signal }); }
  finally { clearTimeout(timer); }
}

async function assetJson(context, path, fallback = null) {
  const url = new URL(path, context.request.url);
  const response = context.env?.ASSETS?.fetch ? await context.env.ASSETS.fetch(new Request(url)) : await fetch(url);
  if (!response.ok) return fallback;
  try { return await response.json(); } catch { return fallback; }
}

function codeMatches(value, code) {
  return normalizeStockCode(value) === code;
}

async function fetchChart(code) {
  const symbol = `${code}.T`;
  const response = await fetchWithTimeout(`https://query2.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=1y&includePrePost=false&events=div%2Csplits`, {
    headers:{ Accept:'application/json', 'User-Agent':'Mozilla/5.0 (compatible; ValueScopeStockResearch/1.0)' },
  });
  if (!response.ok) throw new Error(`Yahoo chart HTTP ${response.status}`);
  const result = (await response.json())?.chart?.result?.[0];
  if (!result) throw new Error('Yahoo chart result is empty');
  const timestamps = result.timestamp ?? [];
  const quote = result.indicators?.quote?.[0] ?? {};
  const adjusted = result.indicators?.adjclose?.[0]?.adjclose ?? quote.close ?? [];
  const rows = timestamps.map((timestamp,index) => ({
    date:new Date(Number(timestamp) * 1000).toISOString().slice(0,10),
    open:quote.open?.[index], high:quote.high?.[index], low:quote.low?.[index], close:quote.close?.[index],
    adjusted_close:adjusted?.[index], volume:quote.volume?.[index],
  }));
  return enrichChartBars(rows);
}

async function fetchNews(companyName, code) {
  const query = encodeURIComponent(`"${companyName}" ${code} 株 決算`);
  const response = await fetchWithTimeout(`https://news.google.com/rss/search?q=${query}&hl=ja&gl=JP&ceid=JP:ja`, {
    headers:{ Accept:'application/rss+xml,application/xml,text/xml', 'User-Agent':'Mozilla/5.0 (compatible; ValueScopeStockResearch/1.0)' },
  });
  if (!response.ok) throw new Error(`Google News RSS HTTP ${response.status}`);
  return parseNewsRss(await response.text(), 8);
}

function sourceResult(result) {
  return result.status === 'fulfilled' ? { ok:true, value:result.value, error:null } : { ok:false, value:null, error:String(result.reason?.message ?? result.reason ?? 'unavailable') };
}

export async function onRequestGet(context) {
  const started = Date.now();
  const requestUrl = new URL(context.request.url);
  const code = normalizeStockCode(requestUrl.searchParams.get('code'));
  if (!code) return Response.json({ error:'invalid_code' }, { status:400, headers:{ 'Cache-Control':'no-store' } });
  const cacheKey = new Request(`${requestUrl.origin}${requestUrl.pathname}?code=${code}`, { method:'GET' });
  const cached = await caches.default.match(cacheKey);
  if (cached) return cached;

  const [index, ranking, report, local] = await Promise.all([
    assetJson(context, '/data/stock-details/index.json', { securities:[] }),
    assetJson(context, '/jquants-ranking.json', { rows:[] }),
    assetJson(context, '/data/paper-trading/latest-report.json', { decisions:[] }),
    assetJson(context, `/data/stock-details/${code}.json`, {}),
  ]);
  const security = (index?.securities ?? []).find(item => codeMatches(item.code, code));
  if (!security) return Response.json({ error:'unknown_code' }, { status:404, headers:{ 'Cache-Control':'no-store' } });
  const rankingRow = (ranking?.rows ?? []).find(item => codeMatches(item.code, code)) ?? null;
  const decision = (report?.decisions ?? []).find(item => codeMatches(item.code ?? item.symbol, code)) ?? null;
  const companyName = security.company_name ?? rankingRow?.company_name ?? decision?.company_name ?? code;
  const [chartResult, newsResult] = await Promise.allSettled([fetchChart(code), fetchNews(companyName, code)]);
  const chart = sourceResult(chartResult);
  const news = sourceResult(newsResult);
  const payload = {
    generated_at:new Date().toISOString(), code, company_name:companyName,
    security:{ ...security, market:rankingRow?.market ?? security.market ?? null, sector:rankingRow?.sector ?? security.sector ?? null },
    ranking:rankingRow,
    decision,
    data_cutoff:report?.fundamental_source?.effective_data_cutoff ?? ranking?.metadata?.effective_data_cutoff ?? null,
    plan:report?.fundamental_source?.plan ?? ranking?.metadata?.plan ?? 'free',
    financial_history_status:local?.financial_history_status ?? 'unavailable_until_jquants_refresh',
    financial_capabilities:local?.financial_capabilities ?? { summary:true, full_statements:false },
    financial_summaries:local?.financial_summaries ?? [],
    next_earnings_date:local?.next_earnings_date ?? null,
    official_disclosures:local?.official_disclosures ?? [],
    official_disclosure_status:local?.official_disclosure_status ?? 'tdnet_addon_not_configured',
    chart:chart.value ?? [], news:news.value ?? [],
    source_status:{ chart:{ok:chart.ok,error:chart.error}, news:{ok:news.ok,error:news.error}, financials:{ok:(local?.financial_summaries ?? []).length>0,status:local?.financial_history_status ?? 'unavailable_until_jquants_refresh'}, disclosures:{ok:(local?.official_disclosures ?? []).length>0,status:local?.official_disclosure_status ?? 'tdnet_addon_not_configured'} },
    paper_only:true,
  };
  const duration = Date.now() - started;
  const response = Response.json(payload, { headers:{ 'Cache-Control':CACHE_CONTROL, 'Content-Type':'application/json; charset=utf-8', 'X-Content-Type-Options':'nosniff', 'Server-Timing':`stock-detail;dur=${duration}, chart;desc="${chart.ok?'ok':'failed'}", news;desc="${news.ok?'ok':'failed'}"` } });
  context.waitUntil(caches.default.put(cacheKey, response.clone()));
  return response;
}
