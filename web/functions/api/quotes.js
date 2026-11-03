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
  if (!primary?.price) return { ...security, current_price:null, usable:false, verification:'unavailable', entry_price:entryPrice, quantity:QUANTITY, position_value:null, unrealized_pnl:null, return_pct:null, errors:sourceErrors };
  const checks = [yahoo, google, chart].filter(item => item && item !== primary && cleanNumber(item.price) !== null);
  const differences = checks.map(check => Math.abs(primary.price - check.price) / primary.price * 100);
  const maxDifference = differences.length ? Math.max(...differences) : null;
  const discrepancy = maxDifference !== null && maxDifference > 3;
  const dayHigh = yahoo?.day_high ?? chart?.day_high ?? null;
  const dayLow = yahoo?.day_low ?? chart?.day_low ?? null;
  const inRange = (dayHigh === null || primary.price <= dayHigh) && (dayLow === null || primary.price >= dayLow);
  const recordedAt = chart?.quote_time ?? google?.quote_time ?? null;
  const timestamp = Date.parse(recordedAt ?? '');
  const quoteFresh = Number.isFinite(timestamp) && timestamp <= Date.now() + 600000 && Date.now() - timestamp <= 4 * 86400000;
  const independent = Boolean(google && (yahoo || chart));
  const adjustment_review_required = entryPrice > 0 && (primary.price / entryPrice < .4 || primary.price / entryPrice > 2.5);
  const usable = independent && quoteFresh && inRange && !discrepancy && !adjustment_review_required;
  let verification = 'single-source';
  if (independent && checks.length && maxDifference !== null && maxDifference <= 1) verification = 'double-checked';
  else if (independent && checks.length && maxDifference !== null && maxDifference <= 3) verification = 'checked-with-time-skew';
  else if (discrepancy) verification = 'price-discrepancy';
  const secondary = google && google !== primary ? google : chart && chart !== primary ? chart : yahoo && yahoo !== primary ? yahoo : null;
  const valuationPrice = usable ? primary.price : null;
  const pnl = usable ? (valuationPrice - entryPrice) * QUANTITY : null;
  return { ...security, current_price:primary.price, quote_time:recordedAt, primary_source:primary.source, primary_source_mode:primary.source_mode, day_high:dayHigh, day_low:dayLow, secondary_price:secondary?.price ?? null, secondary_time:secondary?.quote_time ?? null, secondary_source:secondary?.source ?? null, max_difference_pct:maxDifference, verification, usable, quote_fresh:quoteFresh, independent_source_check:independent, adjustment_review_required, entry_price:entryPrice, quantity:QUANTITY, position_value:usable ? valuationPrice * QUANTITY : null, unrealized_pnl:pnl, return_pct:usable && entryPrice ? pnl / (entryPrice * QUANTITY) * 100 : null, errors:sourceErrors };
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
      catch (error) { results[index] = { ...items[index], current_price:null, usable:false, verification:'unavailable', entry_price:ENTRY_PRICES[items[index].symbol], quantity:QUANTITY, position_value:null, unrealized_pnl:null, return_pct:null, errors:[String(error?.message ?? error)] }; }
    }
  };
  await Promise.all(Array.from({ length:Math.min(limit, items.length) }, worker));
  return results;
}

function compactPayload(full) {
  return { generated_at:full.generated_at, timezone:full.timezone, refresh_seconds:full.refresh_seconds, source_policy:full.source_policy, source_status:full.source_status, partial:full.partial, portfolio:full.portfolio, positions:full.positions.map(quote => ({ symbol:quote.symbol, code:quote.code, name:quote.name, entry_price:quote.entry_price, quantity:quote.quantity, current_price:quote.current_price, quote_time:quote.quote_time, unrealized_pnl:quote.unrealized_pnl, return_pct:quote.return_pct, verification:quote.verification, usable:quote.usable, max_difference_pct:quote.max_difference_pct, primary_source:quote.primary_source, secondary_source:quote.secondary_source, errors:quote.errors ?? [] })) };
}


async function readPaperAsset(context, path) {
  const url = new URL(path, context.request.url).toString();
  const response = context.env?.ASSETS?.fetch
    ? await context.env.ASSETS.fetch(new Request(url))
    : await fetch(url, { headers:{ Accept:'application/json' } });
  if (!response.ok) throw new Error('paper asset HTTP ' + response.status + ': ' + path);
  return response.json();
}
async function buildPaperPortfolio(context, quotes) {
  try {
    const [ledger, report] = await Promise.all([
      readPaperAsset(context, '/data/paper-trading/portfolio.json'),
      readPaperAsset(context, '/data/paper-trading/latest-report.json'),
    ]);
    if (ledger.paper_only !== true || report.paper_only !== true) throw new Error('paper ledger integrity gate failed');
    const cash = cleanNumber(ledger.cash), seed = cleanNumber(ledger.seed_cost_basis);
    const map = new Map(quotes.map(q => [q.code, q]));
    const positions = (ledger.positions ?? []).map(row => {
      const quote = map.get(String(row.code)) ?? {};
      const qty = cleanNumber(row.quantity), avg = cleanNumber(row.avg_cost);
      const accepted = quote.usable === true && qty !== null && qty > 0 && avg !== null && avg > 0;
      return { symbol:row.symbol, code:String(row.code), name:row.company_name, quantity:qty,
        entry_price:avg, current_price:quote.current_price ?? null, quote_time:quote.quote_time ?? null,
        verification:quote.verification ?? 'unavailable', usable:accepted,
        max_difference_pct:quote.max_difference_pct ?? null, primary_source:quote.primary_source ?? null,
        secondary_source:quote.secondary_source ?? null, errors:quote.errors ?? [],
        verified_value:accepted ? quote.current_price * qty : null };
    });
    const count = positions.filter(p => p.usable).length;
    const complete = Boolean(cash !== null && seed !== null && seed > 0 &&
      positions.length > 0 && count === positions.length);
    const currentEquity = complete ? cash + positions.reduce((sum,p) => sum + p.verified_value,0) : null;
    const unrealized = complete ? positions.reduce((sum,p) => sum + (p.current_price - p.entry_price) * p.quantity,0) : null;
    const pnl = complete ? currentEquity - seed : null;
    const confirmed = {
      generated_at:report.generated_at, trading_date:report.trading_date,
      equity:report.summary?.equity ?? null, total_pnl:report.summary?.total_pnl ?? null,
      cumulative_return_pct:report.summary?.cumulative_return_pct ?? null,
      unrealized_pnl:report.summary?.unrealized_pnl ?? null,
    };
    return {positions,portfolio:{ basis:'paper-ledger', paper_only:true,
      total_entry_value:seed, initial_capital:seed, cash, realized_pnl:cleanNumber(ledger.realized_pnl),
      total_current_value:currentEquity, total_unrealized_pnl:unrealized, unrealized_pnl:unrealized,
      total_pnl:pnl, total_return_pct:complete?pnl/seed*100:null,
      valuation_complete:complete, usable_quotes:count, position_count:positions.length,
      double_checked:positions.filter(p => p.verification === 'double-checked' && p.usable).length,
      confirmed, valuation_note:complete?'全保有銘柄の株価を検証':'検証未完了のため現在損益は算定しない。最終保存値と混同しない。' }};
  } catch (error) {
    return {positions:[],portfolio:{basis:'paper-ledger',paper_only:true,
      valuation_complete:false,usable_quotes:0,position_count:null,
      total_current_value:null,total_unrealized_pnl:null,unrealized_pnl:null,total_pnl:null,
      total_return_pct:null,confirmed:null,valuation_note:'ledger_unavailable: ' + String(error?.message ?? error)}};
  }
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
  const paper = await buildPaperPortfolio(context, quotes);
  const usable = quotes.filter(q => q.usable).length;
  const failed = quotes.filter(q => q.current_price === null).length;
  const sourceErrors = quotes.reduce((sum, quote) => sum + (quote.errors?.length ?? 0), 0);
  const full = {
    generated_at:new Date().toISOString(),
    timezone:'Asia/Tokyo',
    refresh_seconds:60,
    source_policy:{ primary:'Yahoo / Google 公開株価', secondary:'Yahoo Finance chart', validation:'独立情報源の一致・時刻・企業行動を照合できない価格を損益へ使用しない', warning:'公開データは遅延・訂正されます。実発注・実口座の損益ではありません。' },
    source_status:{ usable, failed, total:quotes.length, source_errors:sourceErrors, concurrency:CONCURRENCY, timeout_ms:SOURCE_TIMEOUT_MS, ledger_verified:paper.portfolio.valuation_complete },
    partial:usable < quotes.length || !paper.portfolio.valuation_complete,
    portfolio:paper.portfolio,
    positions:paper.positions,
    quotes,
  };
  const payload = compact ? compactPayload(full) : full;
  const response = Response.json(payload, { headers:{ 'Cache-Control':'public, max-age=45, s-maxage=55, stale-while-revalidate=120', 'Content-Type':'application/json; charset=utf-8', 'X-Content-Type-Options':'nosniff' } });
  if (context.waitUntil && caches?.default) context.waitUntil(caches.default.put(cacheKey, response.clone()));
  return response;
}
