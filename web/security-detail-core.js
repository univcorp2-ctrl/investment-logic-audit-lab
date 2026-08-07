export const DETAIL_TABS = Object.freeze([
  { key:'overview', label:'推奨理由' },
  { key:'financials', label:'決算・財務' },
  { key:'news', label:'開示・ニュース' },
  { key:'chart', label:'チャート' },
]);

export function normalizeSecurityCode(value = '') {
  const text = String(value).trim().toUpperCase().replace(/\.T$/, '');
  return text.length === 5 && text.endsWith('0') ? text.slice(0, -1) : text;
}

export function extractSecurityCode(text, securities = []) {
  const source = String(text ?? '');
  for (const security of securities) {
    const code = normalizeSecurityCode(security.code);
    if (source.includes(code) || source.includes(security.company_name ?? '')) return code;
  }
  const match = source.match(/(?:^|\D)(\d{4}|\d{3}[A-Z])(?:\D|$)/i);
  return match ? normalizeSecurityCode(match[1]) : null;
}

export function recommendationLabel(action) {
  return ({ SIM_BUY:'買い候補', SIM_HOLD:'保有継続', SIM_SELL:'売却候補', WATCH:'監視', NO_DATA:'データ不足' })[action] ?? String(action ?? '不明');
}

export function sliceChartBars(bars = [], range = '6m') {
  const size = ({ '3m':66, '6m':132, '1y':260 })[range] ?? 132;
  return bars.slice(-size);
}

export function chartGeometry(bars = [], width = 900, height = 320) {
  const clean = bars.filter(bar => [bar.open, bar.high, bar.low, bar.close].every(value => Number.isFinite(Number(value))));
  if (!clean.length) return { bars:[], min:0, max:1, x:()=>0, y:()=>0, bodyWidth:4 };
  const values = clean.flatMap(bar => [Number(bar.low), Number(bar.high), Number(bar.sma20), Number(bar.sma60)]).filter(Number.isFinite);
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
  return { bars:clean, min, max, x, y, bodyWidth:Math.max(2, Math.min(8, (right - left) / clean.length * .55)), width, height, left, right, top, bottom };
}

export function reasonGroups(detail = {}) {
  const recommendation = detail.recommendation ?? {};
  return {
    fundamental: {
      score: recommendation.fundamental?.score ?? detail.scores?.overall_score,
      positive: recommendation.fundamental?.positive_reasons ?? [],
      risks: recommendation.fundamental?.risk_reasons ?? [],
      missing: recommendation.fundamental?.missing ?? [],
    },
    technical: {
      score: recommendation.technical?.score ?? detail.scores?.technical_score,
      regime: recommendation.technical?.regime,
      positive: recommendation.technical?.positive_reasons ?? [],
      risks: recommendation.technical?.risk_reasons ?? [],
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
