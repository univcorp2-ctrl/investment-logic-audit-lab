const SECURITIES = Object.freeze([
  { symbol: '8035.T', code: '8035', name: '東京エレクトロン' },
  { symbol: '6857.T', code: '6857', name: 'アドバンテスト' },
  { symbol: '5803.T', code: '5803', name: 'フジクラ' },
  { symbol: '5016.T', code: '5016', name: 'JX金属' },
  { symbol: '6920.T', code: '6920', name: 'レーザーテック' },
  { symbol: '9983.T', code: '9983', name: 'ファーストリテイリング' },
  { symbol: '7974.T', code: '7974', name: '任天堂' },
  { symbol: '285A.T', code: '285A', name: 'キオクシアホールディングス' },
  { symbol: '9984.T', code: '9984', name: 'ソフトバンクグループ' },
  { symbol: '5706.T', code: '5706', name: '三井金属' },
]);
const ENTRY_PRICES = Object.freeze({ '8035.T':54720,'6857.T':31260,'5803.T':4294,'5016.T':3827,'6920.T':41060,'9983.T':79030,'7974.T':7588,'285A.T':49190,'9984.T':5412,'5706.T':30840 });
const QUANTITY = 100;
const UPSTREAM_TIMEOUT_MS = 2500;

const cleanNumber = value => {
  if (value === null || value === undefined || String(value).trim() === '') return null;
  const parsed = Number(String(value).replaceAll(',', ''));
  return Number.isFinite(parsed) ? parsed : null;
};

async function timedFetch(url, options = {}, timeoutMs = UPSTREAM_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error('upstream timeout')), timeoutMs);
  try { return await fetch(url, { ...options, signal: controller.signal }); }
  finally { clearTimeout(timer); }
}

async function fetchChart(security) {
  const response = await timedFetch(`https://query2.finance.yahoo.com/v8/finance/chart/${security.symbol}?interval=1m&range=1d&includePrePost=false`, {
    headers: { Accept: 'application/json', 'User-Agent': 'Mozilla/5.0 (compatible; ValueScopeFast/2.0)' },
  });
  if (!response.ok) throw new Error(`Yahoo chart HTTP ${response.status}`);
  const payload = await response.json();
  const result = payload?.chart?.result?.[0];
  const meta = result?.meta;
  if (!meta) throw new Error('Yahoo chart result is empty');
  const price = cleanNumber(meta.regularMarketPrice);
  if (price === null) throw new Error('Yahoo chart price is unavailable');
  return {
    price,
    quote_time: Number.isFinite(Number(meta.regularMarketTime)) ? new Date(Number(meta.regularMarketTime) * 1000).toISOString() : null,
    day_high: cleanNumber(meta.regularMarketDayHigh),
    day_low: cleanNumber(meta.regularMarketDayLow),
    source: 'Yahoo Finance chart API',
    source_mode: 'fast-chart',
  };
}

async function fetchGoogleFinance(security) {
  const response = await timedFetch(`https://www.google.com/finance/quote/${security.code}:TYO?hl=ja`, {
    headers: { Accept: 'text/html,application/xhtml+xml', 'Accept-Language': 'ja-JP,ja;q=0.9', 'User-Agent': 'Mozilla/5.0 (compatible; ValueScopeVerify/2.0)' },
  });
  if (!response.ok) throw new Error(`Google Finance HTTP ${response.status}`);
  const html = await response.text();
  const match = html.match(/data-last-price=["']?([0-9.]+)/i) ?? html.match(/class=["'][^"']*YMlKec[^"']*["'][^>]*>\s*[¥￥]?\s*([0-9,.]+)/i);
  const price = cleanNumber(match?.[1]);
  if (price === null) throw new Error('Google Finance price pattern was not found');
  const timestamp = html.match(/data-last-normal-market-timestamp=["']?([0-9]+)/i)?.[1];
  return { price, quote_time: timestamp ? new Date(Number(timestamp) * 1000).toISOString() : null, source: 'Google Finance', source_mode: 'deep-check' };
}

function fallbackQuote(security, error) {
  const entryPrice = ENTRY_PRICES[security.symbol];
  return { ...security, current_price:null, quote_time:null, primary_source:null, primary_source_mode:'entry-fallback', day_high:null, day_low:null, secondary_price:null, secondary_time:null, secondary_source:null, max_difference_pct:null, verification:'unavailable', usable:false, entry_price:entryPrice, quantity:QUANTITY, position_value:entryPrice*QUANTITY, unrealized_pnl:0, return_pct:0, errors:[String(error?.message ?? error ?? 'unavailable')] };
}

function finalizeFast(security, chart) {
  const entryPrice = ENTRY_PRICES[security.symbol];
  const high = chart.day_high;
  const low = chart.day_low;
  const usable = (high === null || chart.price <= high) && (low === null || chart.price >= low);
  const valuationPrice = usable ? chart.price : entryPrice;
  const pnl = (valuationPrice - entryPrice) * QUANTITY;
  return { ...security, current_price:chart.price, quote_time:chart.quote_time, primary_source:chart.source, primary_source_mode:chart.source_mode, day_high:high, day_low:low, secondary_price:null, secondary_time:null, secondary_source:null, max_difference_pct:null, verification:usable?'internally-checked':'price-discrepancy', usable, entry_price:entryPrice, quantity:QUANTITY, position_value:valuationPrice*QUANTITY, unrealized_pnl:pnl, return_pct:entryPrice?pnl/(entryPrice*QUANTITY)*100:0, errors:usable?[]:['price outside reported daily range'] };
}

async function buildFastQuotes() {
  const settled = await Promise.allSettled(SECURITIES.map(fetchChart));
  return settled.map((result, index) => result.status === 'fulfilled' ? finalizeFast(SECURITIES[index], result.value) : fallbackQuote(SECURITIES[index], result.reason));
}

async function buildDeepQuotes() {
  return Promise.all(SECURITIES.map(async security => {
    const [chartResult, googleResult] = await Promise.allSettled([fetchChart(security), fetchGoogleFinance(security)]);
    if (chartResult.status !== 'fulfilled') return fallbackQuote(security, chartResult.reason);
    const fast = finalizeFast(security, chartResult.value);
    if (googleResult.status !== 'fulfilled') return fast;
    const difference = Math.abs(chartResult.value.price - googleResult.value.price) / chartResult.value.price * 100;
    const usable = fast.usable && difference <= 3;
    const entryPrice = ENTRY_PRICES[security.symbol];
    const valuationPrice = usable ? chartResult.value.price : entryPrice;
    const pnl = (valuationPrice - entryPrice) * QUANTITY;
    return { ...fast, secondary_price:googleResult.value.price, secondary_time:googleResult.value.quote_time, secondary_source:googleResult.value.source, max_difference_pct:difference, verification:difference<=1?'double-checked':difference<=3?'checked-with-time-skew':'price-discrepancy', usable, position_value:valuationPrice*QUANTITY, unrealized_pnl:pnl, return_pct:entryPrice?pnl/(entryPrice*QUANTITY)*100:0 };
  }));
}

function payloadFor(quotes, durationMs, verified) {
  const totalEntryValue = quotes.reduce((sum, quote) => sum + quote.entry_price * quote.quantity, 0);
  const totalCurrentValue = quotes.reduce((sum, quote) => sum + quote.position_value, 0);
  const totalPnl = totalCurrentValue - totalEntryValue;
  const portfolio = {
    total_entry_value:totalEntryValue,
    total_current_value:totalCurrentValue,
    total_unrealized_pnl:totalPnl,
    total_return_pct:totalEntryValue?totalPnl/totalEntryValue*100:0,
    winners:quotes.filter(quote=>quote.unrealized_pnl>0).length,
    losers:quotes.filter(quote=>quote.unrealized_pnl<0).length,
    unchanged:quotes.filter(quote=>quote.unrealized_pnl===0).length,
    usable_quotes:quotes.filter(quote=>quote.usable).length,
    double_checked:quotes.filter(quote=>quote.verification==='double-checked').length,
    checked_with_time_skew:quotes.filter(quote=>quote.verification==='checked-with-time-skew').length,
  };
  const positions = quotes.map(quote => ({ symbol:quote.symbol, code:quote.code, name:quote.name, entry_price:quote.entry_price, current_price:quote.current_price, quote_time:quote.quote_time, unrealized_pnl:quote.unrealized_pnl, return_pct:quote.return_pct, verification:quote.verification, usable:quote.usable, max_difference_pct:quote.max_difference_pct }));
  return {
    generated_at:new Date().toISOString(),
    timezone:'Asia/Tokyo',
    refresh_seconds:60,
    mode:verified?'deep-verified':'fast-chart',
    source_policy:{ primary:'Yahoo Finance query2 chart API（高速並列）', optional_verification:'verify=1 のみGoogle Finance照合', entry_check:'仮想約定価格は開始時に複数ソースで照合済み', warning:'通常画面は高速な単一チャートソースです。double-checkedとは表示しません。' },
    timing:{ server_ms:Math.round(durationMs), upstream_timeout_ms:UPSTREAM_TIMEOUT_MS },
    portfolio,
    positions,
    quotes,
  };
}

export async function onRequestGet(context) {
  const started = Date.now();
  const requestUrl = new URL(context.request.url);
  const verified = requestUrl.searchParams.get('verify') === '1';
  const cacheUrl = new URL(requestUrl.origin + requestUrl.pathname);
  cacheUrl.searchParams.set('mode', verified ? 'verified' : 'fast');
  const cacheKey = new Request(cacheUrl.toString(), { method:'GET' });
  const cached = await caches.default.match(cacheKey);
  if (cached) return cached;
  const quotes = verified ? await buildDeepQuotes() : await buildFastQuotes();
  const response = Response.json(payloadFor(quotes, Date.now()-started, verified), { headers:{ 'Cache-Control':'public, max-age=45, s-maxage=60, stale-while-revalidate=300', 'Content-Type':'application/json; charset=utf-8', 'Server-Timing':`quotes;dur=${Date.now()-started}`, 'X-Content-Type-Options':'nosniff' } });
  context.waitUntil(caches.default.put(cacheKey, response.clone()));
  return response;
}
