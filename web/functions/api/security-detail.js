const SOURCE_TIMEOUT_MS = 4500;
const CACHE_CONTROL = 'public, max-age=120, s-maxage=300, stale-while-revalidate=900';
const JQUANTS_BASE = 'https://api.jquants.com/v2';

const finite = value => {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(String(value).replaceAll(',', ''));
  return Number.isFinite(parsed) ? parsed : null;
};
const code4 = value => {
  const text = String(value ?? '').trim().toUpperCase().replace(/\.T$/, '');
  const normalized = text.length === 5 && text.endsWith('0') ? text.slice(0, -1) : text;
  return /^[0-9A-Z]{4}$/.test(normalized) ? normalized : null;
};
const decodeXml = value => String(value ?? '').replace(/^<!\[CDATA\[|\]\]>$/g, '').replaceAll('&amp;', '&').replaceAll('&lt;', '<').replaceAll('&gt;', '>').replaceAll('&quot;', '"').replaceAll('&#39;', "'").trim();

async function timedFetch(url, init = {}, timeoutMs = SOURCE_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort('timeout'), timeoutMs);
  try { return await fetch(url, { ...init, signal:controller.signal }); }
  finally { clearTimeout(timer); }
}

async function assetJson(context, path, fallback) {
  const url = new URL(path, context.request.url);
  try {
    const response = context.env?.ASSETS?.fetch
      ? await context.env.ASSETS.fetch(new Request(url))
      : await fetch(url);
    return response.ok ? await response.json() : fallback;
  } catch {
    return fallback;
  }
}

function findByCode(rows, code) {
  return (rows ?? []).find(row => code4(row.code ?? row.symbol) === code) ?? null;
}

async function jqAll(env, path, params = {}) {
  const key = env?.JQUANTS_API_KEY;
  if (!key) return { status:'not_configured', rows:[], error:null };
  const rows = [];
  let paginationKey = null;
  try {
    do {
      const url = new URL(`${JQUANTS_BASE}${path}`);
      Object.entries(params).forEach(([name, value]) => value !== null && value !== undefined && value !== '' && url.searchParams.set(name, value));
      if (paginationKey) url.searchParams.set('pagination_key', paginationKey);
      const response = await timedFetch(url, { headers:{ 'x-api-key':key, Accept:'application/json' } });
      if (response.status === 401 || response.status === 403) return { status:'not_entitled', rows:[], error:`HTTP ${response.status}` };
      if (!response.ok) return { status:'error', rows:[], error:`HTTP ${response.status}` };
      const payload = await response.json();
      const batch = payload.data ?? payload.info ?? payload.statements ?? payload.results ?? [];
      if (Array.isArray(batch)) rows.push(...batch);
      paginationKey = payload.pagination_key ?? null;
    } while (paginationKey && rows.length < 5000);
    return { status:'ok', rows, error:null };
  } catch (error) {
    return { status:error?.name === 'AbortError' ? 'timeout' : 'error', rows:[], error:String(error?.message ?? error) };
  }
}

async function yahooChart(code) {
  const url = `https://query2.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(`${code}.T`)}?interval=1d&range=1y&includePrePost=false&events=div%2Csplits`;
  const response = await timedFetch(url, { headers:{ Accept:'application/json', 'User-Agent':'Mozilla/5.0 (compatible; ValueScopeResearch/2.0)' } });
  if (!response.ok) throw new Error(`Yahoo chart HTTP ${response.status}`);
  const result = (await response.json())?.chart?.result?.[0];
  if (!result) throw new Error('Yahoo chart result is empty');
  const timestamps = result.timestamp ?? [];
  const quote = result.indicators?.quote?.[0] ?? {};
  const adjusted = result.indicators?.adjclose?.[0]?.adjclose ?? quote.close ?? [];
  return timestamps.map((timestamp, index) => ({
    date:new Date(Number(timestamp) * 1000).toISOString().slice(0, 10),
    open:finite(quote.open?.[index]), high:finite(quote.high?.[index]), low:finite(quote.low?.[index]), close:finite(quote.close?.[index]),
    adjusted_close:finite(adjusted?.[index]), volume:finite(quote.volume?.[index]),
  })).filter(row => row.open !== null && row.high !== null && row.low !== null && row.close !== null);
}

function parseGeneralNewsRss(xml, limit = 8) {
  const tag = (body, name) => decodeXml(body.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${name}>`, 'i'))?.[1] ?? '');
  return [...String(xml).matchAll(/<item>([\s\S]*?)<\/item>/gi)].slice(0, limit).map(match => {
    const body = match[1];
    const source = body.match(/<source(?:\s+url="([^"]*)")?[^>]*>([\s\S]*?)<\/source>/i);
    return {
      title:tag(body, 'title'),
      source:decodeXml(source?.[2] ?? '') || 'Google News',
      published_at:tag(body, 'pubDate') || null,
      link:tag(body, 'link'),
    };
  }).filter(item => item.title && /^https?:\/\//.test(item.link));
}

async function generalNews(name, code) {
  const query = encodeURIComponent(`"${name}" ${code} 株 決算`);
  const response = await timedFetch(`https://news.google.com/rss/search?q=${query}&hl=ja&gl=JP&ceid=JP:ja`, { headers:{ Accept:'application/rss+xml,application/xml,text/xml', 'User-Agent':'Mozilla/5.0 (compatible; ValueScopeResearch/2.0)' } });
  if (!response.ok) throw new Error(`Google News RSS HTTP ${response.status}`);
  return parseGeneralNewsRss(await response.text());
}

function periodType(row) {
  const raw = String(row.TypeOfDocument ?? row.DocType ?? row.document_type ?? '').toLowerCase();
  if (raw.includes('1q') || raw.includes('first quarter')) return 'Q1';
  if (raw.includes('2q') || raw.includes('second quarter')) return 'Q2';
  if (raw.includes('3q') || raw.includes('third quarter')) return 'Q3';
  if (raw.includes('fy') || raw.includes('annual')) return 'FY';
  return row.TypeOfDocument ?? row.DocType ?? row.document_type ?? '決算';
}

function normalizeFinancial(row) {
  const get = (...keys) => keys.map(key => row[key]).find(value => value !== undefined && value !== null && value !== '');
  return {
    code:get('Code','code'),
    disclosure_date:get('DisclosedDate','DiscDate','disclosed_date','disclosure_date'),
    period_end:get('CurrentPeriodEndDate','CurPerEn','period_end'),
    fiscal_year_end:get('CurrentFiscalYearEndDate','FYE','fiscal_year_end'),
    document_type:get('TypeOfDocument','DocType','document_type'),
    period_type:periodType(row),
    sales:finite(get('NetSales','Sales','net_sales','sales')),
    operating_profit:finite(get('OperatingProfit','OP','operating_profit')),
    ordinary_profit:finite(get('OrdinaryProfit','OdP','ordinary_profit')),
    net_profit:finite(get('Profit','net_profit','profit')),
    eps:finite(get('EarningsPerShare','EPS','eps')),
    total_assets:finite(get('TotalAssets','TA','total_assets')),
    equity:finite(get('Equity','Eq','equity')),
    operating_cash_flow:finite(get('CashFlowsFromOperatingActivities','CFO','operating_cash_flow')),
    investing_cash_flow:finite(get('CashFlowsFromInvestingActivities','CFI','investing_cash_flow')),
    financing_cash_flow:finite(get('CashFlowsFromFinancingActivities','CFF','financing_cash_flow')),
  };
}

function changes(current, previous) {
  const growth = field => current.period_type === previous?.period_type && current[field] !== null && previous?.[field] !== null && previous?.[field] !== 0
    ? (current[field] / Math.abs(previous[field]) - Math.sign(previous[field])) * 100 : null;
  return { sales_pct:growth('sales'), operating_profit_pct:growth('operating_profit'), ordinary_profit_pct:growth('ordinary_profit'), net_profit_pct:growth('net_profit'), eps_pct:growth('eps') };
}

function splitReasons(decision) {
  const fundamental = decision?.fundamental ?? {};
  const technical = decision?.technical ?? {};
  return {
    fundamental_reasons_positive:[...(fundamental.positive_reasons ?? [])],
    fundamental_risks:[...(fundamental.risk_reasons ?? []), ...(fundamental.missing ?? []).map(name => `欠損: ${name}`)],
    technical_reasons_positive:[...(technical.positive_reasons ?? [])],
    technical_risks:[...(technical.risk_reasons ?? []), ...(technical.missing ?? []).map(name => `欠損: ${name}`)],
  };
}

function localFinancialRows(local) {
  return (local?.financial_summaries ?? []).map(normalizeFinancial);
}

export async function onRequestGet(context) {
  const started = Date.now();
  const requestUrl = new URL(context.request.url);
  const code = code4(requestUrl.searchParams.get('code'));
  if (!code) return Response.json({ error:'invalid_code' }, { status:400, headers:{ 'Cache-Control':'no-store' } });
  const cacheKey = new Request(`${requestUrl.origin}${requestUrl.pathname}?code=${code}`, { method:'GET' });
  const cached = await caches.default.match(cacheKey);
  if (cached) return cached;

  const [index, ranking, report, local] = await Promise.all([
    assetJson(context, '/data/stock-details/index.json', {securities:[]}),
    assetJson(context, '/jquants-ranking.json', {rows:[],metadata:{}}),
    assetJson(context, '/data/paper-trading/latest-report.json', {decisions:[]}),
    assetJson(context, `/data/stock-details/${code}.json`, {}),
  ]);
  const known = findByCode(index.securities, code) ?? findByCode(ranking.rows, code) ?? findByCode(report.decisions, code);
  if (!known) return Response.json({ error:'unknown_code' }, { status:404, headers:{ 'Cache-Control':'no-store' } });
  const rankingRow = findByCode(ranking.rows, code) ?? {};
  const decision = findByCode(report.decisions, code) ?? {};
  const name = known.company_name ?? rankingRow.company_name ?? decision.company_name ?? code;
  const jqCode = `${code}0`;
  const [chartSettled, newsSettled, summary, details, earnings, tdnet] = await Promise.all([
    Promise.allSettled([yahooChart(code)]).then(([result]) => result),
    Promise.allSettled([generalNews(name, code)]).then(([result]) => result),
    jqAll(context.env, '/fins/summary', { code:jqCode }),
    jqAll(context.env, '/fins/details', { code:jqCode }),
    jqAll(context.env, '/fins/earnings-date', { code:jqCode }),
    jqAll(context.env, '/td/list', { code:jqCode }),
  ]);
  const chartRows = chartSettled.status === 'fulfilled' ? chartSettled.value : [];
  const newsItems = newsSettled.status === 'fulfilled' ? newsSettled.value : [];
  const remotePeriods = summary.rows.map(normalizeFinancial).sort((a,b) => String(b.disclosure_date ?? '').localeCompare(String(a.disclosure_date ?? ''))).slice(0,8);
  const periods = remotePeriods.length ? remotePeriods : localFinancialRows(local).slice(0,8);
  periods.forEach((period,index) => { period.changes = changes(period, periods.slice(index+1).find(candidate => candidate.period_type === period.period_type)); });
  const earningsHistory = earnings.rows.map(row => ({ scheduled_date:row.Date ?? row.EarningsDate ?? row.earnings_date ?? null, publication_date:row.PublicationDate ?? null, quarter:row.Quarter ?? row.TypeOfDocument ?? null })).filter(row => row.scheduled_date);
  if (!earningsHistory.length && local?.next_earnings_date) earningsHistory.push({ scheduled_date:local.next_earnings_date, publication_date:null, quarter:null });
  const localDisclosures = local?.official_disclosures ?? [];
  const disclosures = tdnet.rows.length ? tdnet.rows : localDisclosures;
  const technical = decision.technical ?? {};
  const fundamental = decision.fundamental ?? {};
  const recommendation = { summary:decision.decision?.action ?? 'WATCH', confidence:decision.decision?.confidence ?? null, evidence_dates:{ fundamental:fundamental.latest_disclosure_date ?? report.fundamental_source?.effective_data_cutoff ?? null, technical:technical.price_date ?? decision.quote?.quote_time ?? null }, ...splitReasons(decision) };
  const warnings = [...(report.fundamental_source?.warnings ?? [])];
  if (!periods.length) warnings.push('決算サマリーを取得できませんでした。欠損を0として扱いません。');
  if (!chartRows.length) warnings.push('日足チャートを取得できませんでした。');
  const payload = {
    generated_at:new Date().toISOString(), code, name, security:{ code, symbol:`${code}.T`, company_name:name, market:rankingRow.market ?? known.market ?? null, sector:rankingRow.sector ?? known.sector ?? null },
    fundamental:{ score:fundamental.score ?? rankingRow.fundamental_score ?? null, value_score:fundamental.value_score ?? rankingRow.value_score ?? null, quality_score:fundamental.quality_score ?? rankingRow.quality_score ?? null, growth_stability_score:fundamental.growth_stability_score ?? rankingRow.growth_stability_score ?? null, value_trap_risk:fundamental.value_trap_risk ?? rankingRow.value_trap_risk ?? null, data_completeness:fundamental.data_completeness ?? rankingRow.data_completeness ?? null, earnings_yield:fundamental.earnings_yield ?? null, book_to_market:fundamental.book_to_market ?? null, fcf_yield:fundamental.fcf_yield ?? null, roe:fundamental.roe ?? null, operating_margin:fundamental.operating_margin ?? null },
    technical:{ score:technical.score ?? rankingRow.technical_score ?? null, price:technical.price ?? rankingRow.last_price ?? null, sma20:technical.sma20 ?? null, sma60:technical.sma60 ?? null, rsi14:technical.rsi14 ?? null, momentum20_pct:technical.momentum20_pct ?? null, momentum60_pct:technical.momentum60_pct ?? null, volatility20_pct:technical.volatility20_pct ?? null, drawdown20_pct:technical.drawdown20_pct ?? null },
    recommendation,
    holding:decision.holding ?? {quantity:0,avg_cost:null},
    quote:decision.quote ?? {},
    financials:{ status:remotePeriods.length ? summary.status : periods.length ? 'local_sanitized' : summary.status, periods, details_status:details.status, latest_details:details.rows[0] ?? null, full_statements_entitled:details.status !== 'not_entitled', full_statements_available:Boolean(details.rows.length) },
    earnings:{ status:earnings.rows.length ? earnings.status : earningsHistory.length ? 'local_sanitized' : earnings.status, history:earningsHistory, next:earningsHistory[0] ?? null },
    disclosures:{ status:disclosures.length ? (tdnet.rows.length ? tdnet.status : 'local_sanitized') : (local?.official_disclosure_status ?? tdnet.status), items:disclosures, search_url:`https://www.google.com/search?q=${encodeURIComponent(`${name} ${code} 適時開示 決算短信`)}` },
    general_news:newsItems,
    chart:{ status:chartRows.length ? 'ok' : (chartSettled.reason?.name === 'AbortError' ? 'timeout' : 'unavailable'), rows:chartRows },
    data_dates:{ effective_fundamental_cutoff:report.fundamental_source?.effective_data_cutoff ?? ranking.metadata?.effective_data_cutoff ?? null, latest_disclosure_date:fundamental.latest_disclosure_date ?? periods[0]?.disclosure_date ?? null, latest_price_date:chartRows.at(-1)?.date ?? technical.price_date ?? null },
    source_status:{ chart:{ok:Boolean(chartRows.length),error:chartSettled.status === 'rejected' ? String(chartSettled.reason?.message ?? chartSettled.reason) : null}, general_news:{ok:Boolean(newsItems.length),error:newsSettled.status === 'rejected' ? String(newsSettled.reason?.message ?? newsSettled.reason) : null}, financial_summary:{status:summary.status,local_fallback:!remotePeriods.length && periods.length>0}, financial_details:{status:details.status}, earnings:{status:earnings.status,local_fallback:!earnings.rows.length && earningsHistory.length>0}, tdnet:{status:tdnet.status,local_fallback:!tdnet.rows.length && localDisclosures.length>0} },
    warnings, paper_only:true,
  };
  const duration = Date.now() - started;
  const response = Response.json(payload, { headers:{ 'Cache-Control':CACHE_CONTROL, 'Content-Type':'application/json; charset=utf-8', 'X-Content-Type-Options':'nosniff', 'Server-Timing':`security-detail;dur=${duration}, chart;desc="${chartRows.length?'ok':'failed'}", news;desc="${newsItems.length?'ok':'failed'}"` } });
  context.waitUntil(caches.default.put(cacheKey, response.clone()));
  return response;
}
