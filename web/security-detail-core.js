export const DETAIL_TABS = Object.freeze([
  { key: 'overview', label: '概要' },
  { key: 'financials', label: '決算' },
  { key: 'news', label: 'ニュース・開示' },
  { key: 'chart', label: 'チャート' },
  { key: 'reasons', label: '推奨理由' },
]);

export function finiteNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(String(value).replaceAll(',', ''));
  return Number.isFinite(parsed) ? parsed : null;
}

export function normalizeSecurityCode(value = '') {
  const text = String(value).trim().toUpperCase().replace(/\.T$/, '');
  const normalized = text.length === 5 && text.endsWith('0') ? text.slice(0, -1) : text;
  return /^[0-9A-Z]{4}$/.test(normalized) ? normalized : '';
}

export function extractSecurityCode(text, securities = []) {
  const source = String(text ?? '');
  for (const security of securities) {
    const code = normalizeSecurityCode(security.code);
    if (code && (source.includes(code) || source.includes(security.company_name ?? ''))) return code;
  }
  const match = source.match(/(?:^|\D)(\d{4}|\d{3}[A-Z])(?:\D|$)/i);
  return match ? normalizeSecurityCode(match[1]) : null;
}

export function recommendationLabel(action) {
  return ({
    SIM_BUY: '買い候補', SIM_HOLD: '保有継続', SIM_SELL: '売却候補',
    WATCH: '監視', NO_DATA: 'データ不足', BUY: '買い候補', HOLD: '保有継続', SELL: '売却候補',
  })[action] ?? String(action ?? '不明');
}

export function securityHash(currentHash = '', code = '') {
  const params = new URLSearchParams(String(currentHash).replace(/^#/, ''));
  const normalized = normalizeSecurityCode(code);
  if (normalized) params.set('security', normalized);
  else params.delete('security');
  const text = params.toString();
  return text ? `#${text}` : '';
}

export function sma(values = [], period = 20) {
  const result = new Array(values.length).fill(null);
  const window = [];
  let sum = 0;
  let valid = 0;
  values.forEach((raw, index) => {
    const value = finiteNumber(raw);
    window.push(value);
    if (value !== null) { sum += value; valid += 1; }
    if (window.length > period) {
      const removed = window.shift();
      if (removed !== null) { sum -= removed; valid -= 1; }
    }
    if (window.length === period && valid === period) result[index] = sum / period;
  });
  return result;
}

export function enrichCandles(rows = []) {
  const byDate = new Map();
  rows.forEach(row => {
    const date = String(row.date ?? row.Date ?? '').slice(0, 10);
    const candle = {
      date,
      open: finiteNumber(row.open ?? row.Open),
      high: finiteNumber(row.high ?? row.High),
      low: finiteNumber(row.low ?? row.Low),
      close: finiteNumber(row.close ?? row.Close),
      adjusted_close: finiteNumber(row.adjusted_close ?? row.adjustedClose ?? row.close ?? row.Close),
      volume: finiteNumber(row.volume ?? row.Volume),
    };
    if (date && [candle.open, candle.high, candle.low, candle.close].every(value => value !== null)) byDate.set(date, candle);
  });
  const bars = [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
  const closes = bars.map(row => row.adjusted_close ?? row.close);
  const average20 = sma(closes, 20);
  const average60 = sma(closes, 60);
  return bars.map((row, index) => ({ ...row, sma20: average20[index], sma60: average60[index] }));
}

export function filterCandles(rows = [], range = '6m') {
  const size = ({ '1m': 22, '3m': 66, '6m': 132, '1y': 260 })[range] ?? 132;
  return enrichCandles(rows).slice(-size);
}

export function sliceChartBars(rows = [], range = '6m') {
  return filterCandles(rows, range);
}

function rsi(values, period = 14) {
  if (values.length <= period) return null;
  const changes = values.slice(1).map((value, index) => value - values[index]);
  const recent = changes.slice(-period);
  const gains = recent.filter(value => value > 0).reduce((sum, value) => sum + value, 0) / period;
  const losses = -recent.filter(value => value < 0).reduce((sum, value) => sum + value, 0) / period;
  if (losses === 0) return 100;
  return 100 - 100 / (1 + gains / losses);
}

export function latestIndicators(rows = []) {
  const bars = enrichCandles(rows);
  if (!bars.length) return { price:null, sma20:null, sma60:null, rsi14:null, momentum20_pct:null, momentum60_pct:null, volatility20_pct:null, drawdown20_pct:null };
  const closes = bars.map(row => row.adjusted_close ?? row.close);
  const last = bars.at(-1);
  const returns = closes.slice(1).map((value, index) => closes[index] ? value / closes[index] - 1 : null).filter(value => value !== null);
  const recentReturns = returns.slice(-20);
  const mean = recentReturns.length ? recentReturns.reduce((sum, value) => sum + value, 0) / recentReturns.length : null;
  const volatility = mean === null || recentReturns.length < 10 ? null : Math.sqrt(recentReturns.reduce((sum, value) => sum + (value - mean) ** 2, 0) / recentReturns.length) * Math.sqrt(252) * 100;
  const momentum = days => closes.length > days && closes.at(-(days + 1)) ? (closes.at(-1) / closes.at(-(days + 1)) - 1) * 100 : null;
  const high20 = bars.length >= 2 ? Math.max(...bars.slice(-20).map(row => row.high)) : null;
  return {
    price: last.close,
    sma20: last.sma20,
    sma60: last.sma60,
    rsi14: rsi(closes, 14),
    momentum20_pct: momentum(20),
    momentum60_pct: momentum(60),
    volatility20_pct: volatility,
    drawdown20_pct: high20 ? (last.close / high20 - 1) * 100 : null,
  };
}

export function chartGeometry(rows = [], width = 900, height = 320) {
  const clean = enrichCandles(rows);
  if (!clean.length) return { bars:[], min:0, max:1, x:()=>0, y:()=>0, bodyWidth:4, width, height };
  const values = clean.flatMap(bar => [bar.low, bar.high, bar.sma20, bar.sma60]).filter(value => finiteNumber(value) !== null);
  const minRaw = Math.min(...values);
  const maxRaw = Math.max(...values);
  const padding = Math.max(1, (maxRaw - minRaw) * .06);
  const min = minRaw - padding;
  const max = maxRaw + padding;
  const left = 58;
  const right = width - 18;
  const top = 18;
  const bottom = height - 42;
  const x = index => left + (clean.length === 1 ? 0 : index / (clean.length - 1) * (right - left));
  const y = value => bottom - (Number(value) - min) / Math.max(.000001, max - min) * (bottom - top);
  return { bars:clean, min, max, x, y, bodyWidth:Math.max(2, Math.min(8, (right-left)/clean.length*.55)), width, height, left, right, top, bottom };
}

export function compatibleGrowth(current = {}, previous = {}, field) {
  if (!field || current.period_type !== previous.period_type) return null;
  const now = finiteNumber(current[field]);
  const before = finiteNumber(previous[field]);
  if (now === null || before === null || before === 0) return null;
  return (now / Math.abs(before) - Math.sign(before)) * 100;
}

const unique = values => [...new Set((values ?? []).filter(Boolean).map(value => String(value).trim()).filter(Boolean))];

export function reasonGroups(detail = {}) {
  const recommendation = detail.recommendation ?? detail.decision?.decision ?? {};
  const fundamental = recommendation.fundamental ?? detail.fundamental ?? detail.decision?.fundamental ?? {};
  const technical = recommendation.technical ?? detail.technical ?? detail.decision?.technical ?? {};
  return {
    fundamental: {
      score: fundamental.score ?? detail.scores?.overall_score,
      positive: unique(recommendation.fundamental_reasons_positive ?? fundamental.positive_reasons ?? detail.fundamental_reasons_positive ?? []),
      risks: unique(recommendation.fundamental_risks ?? fundamental.risk_reasons ?? detail.fundamental_risks ?? []),
      missing: unique(fundamental.missing ?? []),
    },
    technical: {
      score: technical.score ?? detail.scores?.technical_score,
      regime: technical.regime,
      positive: unique(recommendation.technical_reasons_positive ?? technical.positive_reasons ?? detail.technical_reasons_positive ?? []),
      risks: unique(recommendation.technical_risks ?? technical.risk_reasons ?? detail.technical_risks ?? []),
    },
  };
}

export function pickDisclosure(record = {}) {
  const get = (...keys) => keys.map(key => record[key]).find(value => value !== undefined && value !== null && value !== '');
  return {
    title: get('title','Title','DiscTitle','DocumentTitle','document_title') ?? '適時開示',
    url: get('url','URL','DocumentURL','document_url','file_url') ?? null,
    published_at: get('published_at','date','Date','DiscDate','DisclosedDate') ?? null,
    category: get('category','Category','TypeOfDocument','document_type') ?? 'TDnet',
  };
}

function decodeXml(value = '') {
  return String(value).replace(/^<!\[CDATA\[|\]\]>$/g, '').replaceAll('&amp;', '&').replaceAll('&lt;', '<').replaceAll('&gt;', '>').replaceAll('&quot;', '"').replaceAll('&#39;', "'").trim();
}

export function parseGeneralNewsRss(xml = '', limit = 8) {
  const items = [...String(xml).matchAll(/<item>([\s\S]*?)<\/item>/gi)].slice(0, limit);
  const tag = (body, name) => decodeXml(body.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${name}>`, 'i'))?.[1] ?? '');
  return items.map(match => {
    const body = match[1];
    const source = body.match(/<source(?:\s+url="([^"]*)")?[^>]*>([\s\S]*?)<\/source>/i);
    return {
      title: tag(body, 'title'),
      link: tag(body, 'link'),
      published_at: tag(body, 'pubDate') || null,
      source: decodeXml(source?.[2] ?? '') || 'Google News',
    };
  }).filter(item => item.title && /^https?:\/\//.test(item.link));
}
