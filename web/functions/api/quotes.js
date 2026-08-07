const SECURITIES = Object.freeze([
  { symbol:'8035.T', code:'8035', name:'東京エレクトロン' },
  { symbol:'6857.T', code:'6857', name:'アドバンテスト' },
  { symbol:'5803.T', code:'5803', name:'フジクラ' },
  { symbol:'5016.T', code:'5016', name:'JX金属' },
  { symbol:'6920.T', code:'6920', name:'レーザーテック' },
  { symbol:'9983.T', code:'9983', name:'ファーストリテイリング' },
  { symbol:'7974.T', code:'7974', name:'任天堂' },
  { symbol:'285A.T', code:'285A', name:'キオクシアホールディングス' },
  { symbol:'9984.T', code:'9984', name:'ソフトバンクグループ' },
  { symbol:'5706.T', code:'5706', name:'三井金属' },
]);
const ENTRY_PRICES = Object.freeze({'8035.T':54720,'6857.T':31260,'5803.T':4294,'5016.T':3827,'6920.T':41060,'9983.T':79030,'7974.T':7588,'285A.T':49190,'9984.T':5412,'5706.T':30840});
const QUANTITY = 100;
const SOURCE_TIMEOUT_MS = 2800;
const CONCURRENCY = 4;

const cleanNumber = value => {
  if (value === null || value === undefined || String(value).trim() === '') return null;
  const parsed = Number(String(value).replaceAll(',', ''));
  return Number.isFinite(parsed) ? parsed : null;
};
const decode = text => text.replaceAll('&nbsp;',' ').replaceAll('&amp;','&').replaceAll('&#x2F;','/').replaceAll('&#47;','/').replaceAll('&minus;','-').replaceAll('−','-');
const stripHtml = html => decode(html).replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,' ').replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi,' ').replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').trim();
const tokyoDate = () => {
  const parts = new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Tokyo',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date());
  const value = type => parts.find(part => part.type === type)?.value;
  return `${value('year')}-${value('month')}-${value('day')}`;
};
const timeToIso = time => time ? `${tokyoDate()}T${time}:00+09:00` : null;
const settled = result => result.status === 'fulfilled' ? result.value : null;
const errorName = result => result.status === 'rejected' ? String(result.reason?.message ?? result.reason ?? 'unknown error') : null;

async function fetchWithTimeout(url, init = {}, timeoutMs = SOURCE_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

function parseYahooJapan(html) {
  const text = stripHtml(html);
  const priceMatch = text.match(/([0-9]{1,3}(?:,[0-9]{3})*(?:\.[0-9]+)?)\s*前日比[\s\S]{0,160}?リアルタイム株価\s*(\d{1,2}:\d{2})/);
  if (!priceMatch) throw new Error('Yahoo Japan quote pattern not found');
  const highMatch = text.match(/高値\s*(?:用語\s*)?([0-9]{1,3}(?:,[0-9]{3})*(?:\.[0-9]+)?)\s*\((\d{1,2}:\d{2})\)/);
  const lowMatch = text.match(/安値\s*(?:用語\s*)?([0-9]{1,3}(?:,[0-9]{3})*(?:\.[0-9]+)?)\s*\((\d{1,2}:\d{2})\)/);
  const price = cleanNumber(priceMatch[1]);
  const dayHigh = cleanNumber(highMatch?.[1]);
  const dayLow = cleanNumber(lowMatch?.[1]);
  return { price, quote_time:timeToIso(priceMatch[2]), day_high:dayHigh, day_low:dayLow, in_day_range:price !== null && (dayHigh === null || price <= dayHigh) && (dayLow === null || price >= dayLow), source:'Yahoo!ファイナンス日本版', source_mode:'realtime-labelled' };
}

async function fetchYahooJapan(security) {
  const response = await fetchWithTimeout(`https://finance.yahoo.co.jp/quote/${security.symbol}`, { headers:{Accept:'text/html,application/xhtml+xml','Accept-Language':'ja-JP,ja;q=0.9','User-Agent':'Mozilla/5.0 (compatible; ValueScopeDemo/2.0)'} });
  if (!response.ok) throw new Error(`Yahoo Japan HTTP ${response.status}`);
  return parseYahooJapan(await response.text());
}
async function fetchGoogleFinance(security) {
  const response = await fetchWithTimeout(`https://www.google.com/finance/quote/${security.code}:TYO?hl=ja`, { headers:{Accept:'text/html,application/xhtml+xml','Accept-Language':'ja-JP,ja;q=0.9','User-Agent':'Mozilla/5.0 (compatible; ValueScopeDemo/2.0)'} });
  if (!response.ok) throw new Error(`Google Finance HTTP ${response.status}`);
  const html = await response.text();
  const patterns = [/data-last-price=["']?([0-9.]+)/i, /<[^>]*class=["'][^"']*YMlKec[^"']*["'][^>]*>\s*[¥￥]?\s*([0-9,.]+)/i];
  let price = null;
  for (const pattern of patterns) { price = cleanNumber(html.match(pattern)?.[1]); if (price !== null) break; }
  if (price === null) throw new Error('Google Finance quote pattern not found');
  const timestamp = html.match(/data-last-normal-market-timestamp=["']?([0-9]+)/i)?.[1];
  return { price, quote_time:timestamp ? new Date(Number(timestamp) * 1000).toISOString() : null, source:'Google Finance', source_mode:'secondary-check' };
}
async function fetchYahooChart(security) {
  const response = await fetchWithTimeout(`https://query2.finance.yahoo.com/v8/finance/chart/${security.symbol}?interval=1m&range=1d&includePrePost=false`, { headers:{Accept:'application/json','User-Agent':'Mozilla/5.0 (compatible; ValueScopeDemo/2.0)'} });
  if (!response.ok) throw new Error(`Yahoo chart HTTP ${response.status}`);
  const result = (await response.json())?.chart?.result?.[0];
  const meta = result?.meta;
  if (!meta) throw new Error('Yahoo chart result empty');
  return { price:cleanNumber(meta.regularMarketPrice), quote_time:Number.isFinite(Number(meta.regularMarketTime)) ? new Date(Number(meta.regularMarketTime) * 1000).toISOString() : null, day_high:cleanNumber(meta.regularMarketDayHigh), day_low:cleanNumber(meta.regularMarketDayLow), source:'Yahoo Finance chart API', source_mode:'minute-chart-check' };
}

function finalizeQuote(security, yahooResult, googleResult, chartResult) {
  const yahoo = settled(yahooResult);
  const google = settled(googleResult);
  const chart = settled(chartResult);
  const sourceErrors = [errorName(yahooResult), errorName(googleResult), errorName(chartResult)].filter(Boolean);
  const primary = yahoo ?? chart ?? google;
  const entryPrice = ENTRY_PRICES[security.symbol];
  if (!primary?.price) return { ...security, current_price:null, usable:false, verification:'unavailable', entry_price:entryPrice, quantity:QUANTITY, position_value:entryPrice * QUANTITY, unrealized_pnl:0, return_pct:0, errors:sourceErrors };
  const checks = [yahoo, google, chart].filter(item => item && item !== primary && cleanNumber(item.price) !== null);
  const differences = checks.map(check => Math.abs(primary.price - check.price) / primary.price * 100);
  const maxDifference = differences.length ? Math.max(...differences) : null;
  const discrepancy = maxDifference !== null && maxDifference > 3;
  const dayHigh = yahoo?.day_high ?? chart?.day_high ?? null;
  const dayLow = yahoo?.day_low ?? chart?.day_low ?? null;
  const inRange = (dayHigh === null || primary.price <= dayHigh) && (dayLow === null || primary.price >= dayLow);
  const usable = inRange && !discrepancy;
  let verification = 'single-source';
  if (checks.length && maxDifference !== null && maxDifference <= 1) verification = 'double-checked';
  else if (checks.length && maxDifference !== null && maxDifference <= 3) verification = 'checked-with-time-skew';
  else if (discrepancy) verification = 'price-discrepancy';
  const secondary = google && google !== primary ? google : chart && chart !== primary ? chart : yahoo && yahoo !== primary ? yahoo : null;
  const valuationPrice = usable ? primary.price : entryPrice;
  const pnl = (valuationPrice - entryPrice) * QUANTITY;
  return { ...security, current_price:primary.price, quote_time:primary.quote_time, primary_source:primary.source, primary_source_mode:primary.source_mode, day_high:dayHigh, day_low:dayLow, secondary_price:secondary?.price ?? null, secondary_time:secondary?.quote_time ?? null, secondary_source:secondary?.source ?? null, max_difference_pct:maxDifference, verification, usable, entry_price:entryPrice, quantity:QUANTITY, position_value:valuationPrice * QUANTITY, unrealized_pnl:pnl, return_pct:entryPrice ? pnl / (entryPrice * QUANTITY) * 100 : 0, errors:sourceErrors };
}

async function buildQuote(security) {
  const [yahooResult, googleResult, chartResult] = await Promise.allSettled([fetchYahooJapan(security), fetchGoogleFinance(security), fetchYahooChart(security)]);
  return finalizeQuote(security, yahooResult, googleResult, chartResult);
}

async function mapWithConcurrency(items, limit, mapper) {
  const results = new Array(items.length);
  let nextIndex = 0;
  const worker = async () => {
    while (nextIndex < items.length) {
      const index = nextIndex++;
      try { results[index] = await mapper(items[index], index); }
      catch (error) { results[index] = { ...items[index], current_price:null, usable:false, verification:'unavailable', entry_price:ENTRY_PRICES[items[index].symbol], quantity:QUANTITY, position_value:ENTRY_PRICES[items[index].symbol] * QUANTITY, unrealized_pnl:0, return_pct:0, errors:[String(error?.message ?? error)] }; }
    }
  };
  await Promise.all(Array.from({ length:Math.min(limit, items.length) }, worker));
  return results;
}

function compactPayload(full) {
  return { generated_at:full.generated_at, timezone:full.timezone, refresh_seconds:full.refresh_seconds, source_policy:full.source_policy, source_status:full.source_status, partial:full.partial, portfolio:full.portfolio, positions:full.quotes.map(quote => ({ symbol:quote.symbol, code:quote.code, name:quote.name, entry_price:quote.entry_price, current_price:quote.current_price, quote_time:quote.quote_time, unrealized_pnl:quote.unrealized_pnl, return_pct:quote.return_pct, verification:quote.verification, usable:quote.usable, max_difference_pct:quote.max_difference_pct, primary_source:quote.primary_source, secondary_source:quote.secondary_source, errors:quote.errors ?? [] })) };
}

export async function onRequestGet(context) {
  const requestUrl = new URL(context.request.url);
  const compact = requestUrl.searchParams.get('compact') === '1';
  const force = requestUrl.searchParams.get('force') === '1';
  const cacheUrl = new URL(requestUrl.origin + requestUrl.pathname);
  cacheUrl.searchParams.set('mode', compact ? 'compact' : 'full');
  const cacheKey = new Request(cacheUrl.toString(), { method:'GET' });
  if (!force) {
    const cached = await caches.default.match(cacheKey);
    if (cached) return cached;
  }
  const quotes = await mapWithConcurrency(SECURITIES, CONCURRENCY, buildQuote);
  const totalEntryValue = quotes.reduce((sum, quote) => sum + quote.entry_price * quote.quantity, 0);
  const totalCurrentValue = quotes.reduce((sum, quote) => sum + quote.position_value, 0);
  const totalPnl = totalCurrentValue - totalEntryValue;
  const usable = quotes.filter(quote => quote.usable).length;
  const failed = quotes.filter(quote => quote.current_price === null).length;
  const sourceErrors = quotes.reduce((sum, quote) => sum + (quote.errors?.length ?? 0), 0);
  const full = {
    generated_at:new Date().toISOString(),
    timezone:'Asia/Tokyo',
    refresh_seconds:60,
    source_policy:{ primary:'Yahoo!ファイナンス日本版', secondary:'Yahoo Finance chart / Google Finance', validation:'3%超の価格差は評価へ不使用', warning:'公開データは遅延・停止・訂正される場合があります。' },
    source_status:{ usable, failed, total:quotes.length, source_errors:sourceErrors, concurrency:CONCURRENCY, timeout_ms:SOURCE_TIMEOUT_MS },
    partial:usable < quotes.length,
    portfolio:{ total_entry_value:totalEntryValue, total_current_value:totalCurrentValue, total_unrealized_pnl:totalPnl, total_return_pct:totalEntryValue ? totalPnl / totalEntryValue * 100 : 0, winners:quotes.filter(quote => quote.unrealized_pnl > 0).length, losers:quotes.filter(quote => quote.unrealized_pnl < 0).length, unchanged:quotes.filter(quote => quote.unrealized_pnl === 0).length, usable_quotes:usable, double_checked:quotes.filter(quote => quote.verification === 'double-checked').length, checked_with_time_skew:quotes.filter(quote => quote.verification === 'checked-with-time-skew').length },
    quotes,
  };
  const payload = compact ? compactPayload(full) : full;
  const response = Response.json(payload, { headers:{ 'Cache-Control':'public, max-age=45, s-maxage=55, stale-while-revalidate=120', 'Content-Type':'application/json; charset=utf-8', 'X-Content-Type-Options':'nosniff' } });
  if (usable > 0) context.waitUntil(caches.default.put(cacheKey, response.clone()));
  return response;
}
