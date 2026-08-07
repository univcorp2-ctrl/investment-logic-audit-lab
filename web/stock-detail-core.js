export const STOCK_DETAIL_PERIODS = Object.freeze({ '1m':31, '3m':93, '6m':186, '1y':366 });

export function normalizeStockCode(value) {
  const text = String(value ?? '').trim().toUpperCase().replace(/\.T$/, '');
  const normalized = text.length === 5 && text.endsWith('0') ? text.slice(0, -1) : text;
  return /^[0-9A-Z]{4}$/.test(normalized) ? normalized : null;
}

export function finiteNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(String(value).replaceAll(',', ''));
  return Number.isFinite(parsed) ? parsed : null;
}

const unique = values => [...new Set(values.filter(Boolean).map(value => String(value).trim()).filter(Boolean))];

export function calculateSma(values, period) {
  const result = new Array(values.length).fill(null);
  let sum = 0;
  let valid = 0;
  const window = [];
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

export function enrichChartBars(rows = []) {
  const bars = rows.map(row => ({
    date:String(row.date ?? ''),
    open:finiteNumber(row.open),
    high:finiteNumber(row.high),
    low:finiteNumber(row.low),
    close:finiteNumber(row.close),
    adjusted_close:finiteNumber(row.adjusted_close ?? row.close),
    volume:finiteNumber(row.volume),
  })).filter(row => row.date && [row.open,row.high,row.low,row.close].every(value => value !== null))
    .sort((a,b) => a.date.localeCompare(b.date));
  const closes = bars.map(row => row.adjusted_close ?? row.close);
  const sma20 = calculateSma(closes, 20);
  const sma60 = calculateSma(closes, 60);
  return bars.map((row,index) => ({ ...row, sma20:sma20[index], sma60:sma60[index] }));
}

export function filterChartBars(rows = [], period = '1y') {
  const bars = enrichChartBars(rows);
  if (!bars.length || period === '1y') return bars;
  const days = STOCK_DETAIL_PERIODS[period] ?? 366;
  const end = new Date(`${bars.at(-1).date}T00:00:00Z`);
  const cutoff = new Date(end.getTime() - days * 86400000);
  return bars.filter(row => new Date(`${row.date}T00:00:00Z`) >= cutoff);
}

export function stockChartGeometry(rows = [], width = 900, height = 360) {
  const bars = enrichChartBars(rows);
  if (!bars.length) return { bars:[], candles:[], sma20:[], sma60:[], volumes:[], bounds:null, plot:null };
  const plot = { left:58, right:18, top:18, priceBottom:height - 92, volumeTop:height - 70, bottom:height - 28 };
  const priceMin = Math.min(...bars.map(row => row.low));
  const priceMax = Math.max(...bars.map(row => row.high));
  const priceSpan = Math.max(1e-9, priceMax - priceMin);
  const volumeMax = Math.max(1, ...bars.map(row => row.volume ?? 0));
  const innerWidth = width - plot.left - plot.right;
  const step = innerWidth / Math.max(1, bars.length);
  const candleWidth = Math.max(1.2, Math.min(10, step * .66));
  const x = index => plot.left + step * index + step / 2;
  const y = value => plot.priceBottom - (value - priceMin) / priceSpan * (plot.priceBottom - plot.top);
  const candles = bars.map((row,index) => ({
    index, x:x(index), width:candleWidth,
    openY:y(row.open), closeY:y(row.close), highY:y(row.high), lowY:y(row.low),
    rising:row.close >= row.open,
  }));
  const line = field => bars.map((row,index) => finiteNumber(row[field]) === null ? null : ({ x:x(index), y:y(row[field]), value:row[field], index })).filter(Boolean);
  const volumes = bars.map((row,index) => ({
    x:x(index), width:candleWidth, value:row.volume ?? 0,
    y:plot.bottom - (row.volume ?? 0) / volumeMax * (plot.bottom - plot.volumeTop),
    height:(row.volume ?? 0) / volumeMax * (plot.bottom - plot.volumeTop),
    rising:row.close >= row.open,
  }));
  return { bars, candles, sma20:line('sma20'), sma60:line('sma60'), volumes, bounds:{ priceMin, priceMax, volumeMax }, plot, width, height };
}

function derivedFundamentalReasons(fundamental = {}) {
  const positive = [];
  const risks = [];
  const value = finiteNumber(fundamental.value_score);
  const quality = finiteNumber(fundamental.quality_score);
  const growth = finiteNumber(fundamental.growth_stability_score);
  const trap = finiteNumber(fundamental.value_trap_risk);
  const completeness = finiteNumber(fundamental.data_completeness);
  const fcf = finiteNumber(fundamental.fcf_yield);
  const roe = finiteNumber(fundamental.roe);
  const margin = finiteNumber(fundamental.operating_margin);
  if (value !== null && value >= 65) positive.push(`割安性スコア ${value.toFixed(1)}`);
  if (quality !== null && quality >= 65) positive.push(`企業品質スコア ${quality.toFixed(1)}`);
  if (growth !== null && growth >= 65) positive.push(`成長・安定性スコア ${growth.toFixed(1)}`);
  if (fcf !== null && fcf > 0) positive.push(`FCF利回り ${(fcf * 100).toFixed(2)}%`);
  if (roe !== null && roe > .08) positive.push(`ROE ${(roe * 100).toFixed(2)}%`);
  if (margin !== null && margin > .05) positive.push(`営業利益率 ${(margin * 100).toFixed(2)}%`);
  if (trap !== null && trap <= 35) positive.push(`Value Trap Riskが低い (${trap.toFixed(1)})`);
  if (trap !== null && trap >= 60) risks.push(`Value Trap Riskが高い (${trap.toFixed(1)})`);
  if (completeness === null || completeness < 45) risks.push(`Fundamentalデータ充足率が低い (${completeness === null ? 'データなし' : `${completeness.toFixed(1)}%`})`);
  if (fcf !== null && fcf < 0) risks.push(`FCF利回りがマイナス (${(fcf * 100).toFixed(2)}%)`);
  if (roe !== null && roe < 0) risks.push(`ROEがマイナス (${(roe * 100).toFixed(2)}%)`);
  return { positive, risks };
}

function derivedTechnicalReasons(technical = {}) {
  const positive = [];
  const risks = [];
  const price = finiteNumber(technical.price);
  const sma20 = finiteNumber(technical.sma20);
  const sma60 = finiteNumber(technical.sma60);
  const rsi = finiteNumber(technical.rsi14);
  const momentum20 = finiteNumber(technical.momentum20_pct);
  const momentum60 = finiteNumber(technical.momentum60_pct);
  const volatility = finiteNumber(technical.volatility20_pct);
  const drawdown = finiteNumber(technical.drawdown20_pct);
  if (price !== null && sma20 !== null) (price > sma20 ? positive : risks).push(`株価がSMA20を${price > sma20 ? '上回る' : '下回る'}`);
  if (sma20 !== null && sma60 !== null) (sma20 > sma60 ? positive : risks).push(`SMA20がSMA60を${sma20 > sma60 ? '上回る' : '下回る'}`);
  if (rsi !== null && rsi >= 45 && rsi <= 70) positive.push(`RSI14が強気かつ過熱前 (${rsi.toFixed(1)})`);
  if (rsi !== null && rsi >= 80) risks.push(`RSI14が過熱圏 (${rsi.toFixed(1)})`);
  if (rsi !== null && rsi <= 35) risks.push(`RSI14が弱気圏 (${rsi.toFixed(1)})`);
  if (momentum20 !== null) (momentum20 > 0 ? positive : risks).push(`20日Momentum ${momentum20 >= 0 ? '+' : ''}${momentum20.toFixed(2)}%`);
  if (momentum60 !== null) (momentum60 > 0 ? positive : risks).push(`60日Momentum ${momentum60 >= 0 ? '+' : ''}${momentum60.toFixed(2)}%`);
  if (volatility !== null && volatility >= 70) risks.push(`年率Volatilityが高い (${volatility.toFixed(1)}%)`);
  if (drawdown !== null && drawdown <= -12) risks.push(`20日Drawdownが大きい (${drawdown.toFixed(2)}%)`);
  return { positive, risks };
}

export function splitRecommendationReasons(payload = {}) {
  const decision = payload.decision ?? payload;
  const fundamental = decision.fundamental ?? payload.fundamental ?? {};
  const technical = decision.technical ?? payload.technical ?? {};
  const derivedFundamental = derivedFundamentalReasons(fundamental);
  const derivedTechnical = derivedTechnicalReasons(technical);
  return {
    fundamental: {
      positive:unique([...(fundamental.positive_reasons ?? []), ...derivedFundamental.positive]),
      risks:unique([...(fundamental.risk_reasons ?? []), ...derivedFundamental.risks]),
    },
    technical: {
      positive:unique([...(technical.positive_reasons ?? []), ...derivedTechnical.positive]),
      risks:unique([...(technical.risk_reasons ?? []), ...derivedTechnical.risks]),
    },
  };
}

export function actionLabel(action) {
  return ({ SIM_BUY:'買い候補', SIM_HOLD:'保有継続', SIM_SELL:'売却候補', WATCH:'監視', NO_DATA:'データ不足', BUY:'買い候補', HOLD:'保有継続', SELL:'売却候補' })[action] ?? '監視';
}

export function recommendationExplanation(payload = {}) {
  const action = payload?.decision?.decision?.action ?? payload?.decision?.action ?? payload?.action ?? 'WATCH';
  const groups = splitRecommendationReasons(payload);
  const positives = [...groups.fundamental.positive.slice(0, 2), ...groups.technical.positive.slice(0, 2)];
  const risks = [...groups.fundamental.risks.slice(0, 2), ...groups.technical.risks.slice(0, 2)];
  const support = positives.length ? `支持材料は${positives.join('、')}。` : '十分な支持材料はまだ揃っていません。';
  const caution = risks.length ? `注意点は${risks.join('、')}。` : '重大な機械的警戒条件は記録されていません。';
  return `${actionLabel(action)}。${support}${caution}`;
}

const FINANCIAL_FIELDS = ['net_sales','operating_profit','ordinary_profit','profit','eps','total_assets','equity','operating_cash_flow','investing_cash_flow','financing_cash_flow','forecast_sales','forecast_operating_profit','forecast_profit','forecast_eps'];

export function financialSeries(records = []) {
  const rows = records.map(record => {
    const row = { ...record };
    FINANCIAL_FIELDS.forEach(field => { row[field] = finiteNumber(record[field]); });
    row.disclosed_date = record.disclosed_date ?? record.disclosure_date ?? null;
    row.period_end = record.period_end ?? null;
    row.document_type = record.document_type ?? record.type_of_document ?? null;
    row.operating_margin_pct = row.net_sales && row.operating_profit !== null ? row.operating_profit / row.net_sales * 100 : null;
    row.equity_ratio_pct = row.total_assets && row.equity !== null ? row.equity / row.total_assets * 100 : null;
    return row;
  }).sort((a,b) => String(b.disclosed_date ?? b.period_end ?? '').localeCompare(String(a.disclosed_date ?? a.period_end ?? '')));
  rows.forEach((row,index) => {
    const period = row.period_end ? new Date(`${row.period_end}T00:00:00Z`) : null;
    let prior = null;
    if (period && !Number.isNaN(period.getTime())) {
      prior = rows.find((candidate,candidateIndex) => {
        if (candidateIndex === index || !candidate.period_end) return false;
        const candidateDate = new Date(`${candidate.period_end}T00:00:00Z`);
        const days = Math.abs((period - candidateDate) / 86400000);
        return days >= 320 && days <= 410;
      });
    }
    row.yoy = {};
    for (const field of ['net_sales','operating_profit','ordinary_profit','profit','eps']) {
      const current = row[field];
      const previous = prior?.[field];
      row.yoy[field] = current !== null && previous !== null && previous !== 0 ? (current / Math.abs(previous) - Math.sign(previous)) * 100 : null;
    }
  });
  return rows.slice(0, 8);
}

function decodeXml(value = '') {
  return String(value).replace(/^<!\[CDATA\[|\]\]>$/g, '').replaceAll('&amp;', '&').replaceAll('&lt;', '<').replaceAll('&gt;', '>').replaceAll('&quot;', '"').replaceAll('&#39;', "'").trim();
}

export function parseNewsRss(xml = '', limit = 8) {
  const items = [...String(xml).matchAll(/<item>([\s\S]*?)<\/item>/gi)].slice(0, limit);
  const tag = (body, name) => decodeXml(body.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${name}>`, 'i'))?.[1] ?? '');
  return items.map(match => {
    const body = match[1];
    const sourceMatch = body.match(/<source(?:\s+url="([^"]*)")?[^>]*>([\s\S]*?)<\/source>/i);
    return {
      title:tag(body, 'title'),
      link:tag(body, 'link'),
      published_at:tag(body, 'pubDate') || null,
      source:decodeXml(sourceMatch?.[2] ?? '') || 'Google News',
      source_url:decodeXml(sourceMatch?.[1] ?? '') || null,
    };
  }).filter(item => item.title && /^https?:\/\//.test(item.link));
}

export function stockChartSummary(rows = []) {
  const bars = enrichChartBars(rows);
  if (!bars.length) return { text:'チャートデータなし', last:null, high:null, low:null, change_pct:null, trend:'不明' };
  const first = bars[0];
  const last = bars.at(-1);
  const high = Math.max(...bars.map(row => row.high));
  const low = Math.min(...bars.map(row => row.low));
  const change = first.close ? (last.close / first.close - 1) * 100 : null;
  const trend = last.sma20 !== null && last.sma60 !== null ? (last.close > last.sma20 && last.sma20 > last.sma60 ? '上昇基調' : last.close < last.sma20 && last.sma20 < last.sma60 ? '下降基調' : '中立') : '判定待ち';
  return { text:`${first.date}から${last.date}。終値${last.close}、期間高値${high}、安値${low}、騰落率${change === null ? '不明' : `${change.toFixed(2)}%`}、${trend}。`, last:last.close, high, low, change_pct:change, trend };
}
