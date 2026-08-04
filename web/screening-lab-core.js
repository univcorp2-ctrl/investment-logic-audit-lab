export const DEFAULT_SCREENING_CONFIG = Object.freeze({
  preset: 'balanced',
  minOverall: 0,
  minFundamental: 0,
  minValue: 0,
  minQuality: 0,
  minGrowth: 0,
  minCompleteness: 0,
  minTechnical: 0,
  maxTrap: 100,
  minRsi: 0,
  maxRsi: 100,
  requirePriceAboveSma20: false,
  requireSma20AboveSma60: false,
  minMomentum20: -100,
  minMomentum60: -100,
  maxVolatility: 999,
  minDrawdown: -100,
  market: '',
  sector: '',
  holding: 'all',
  action: 'all',
  minTradingValue: 0,
  topN: 20,
  missingPolicy: 'allow',
  weights: {
    fundamental: 25,
    value: 15,
    quality: 15,
    growth: 10,
    technical: 25,
    liquidity: 10,
    trapPenalty: 15,
  },
});

export const SCREENING_PRESETS = Object.freeze({
  balanced: { label:'バランス', minCompleteness:35, maxTrap:60, minTechnical:45, weights:{fundamental:25,value:15,quality:15,growth:10,technical:25,liquidity:10,trapPenalty:15} },
  value: { label:'割安重視', minValue:65, maxTrap:55, minCompleteness:35, weights:{fundamental:25,value:30,quality:15,growth:5,technical:10,liquidity:15,trapPenalty:20} },
  quality: { label:'品質重視', minQuality:70, minCompleteness:45, maxTrap:45, weights:{fundamental:25,value:10,quality:30,growth:15,technical:10,liquidity:10,trapPenalty:20} },
  trend: { label:'順張り', minTechnical:65, requirePriceAboveSma20:true, requireSma20AboveSma60:true, minMomentum20:0, minMomentum60:0, weights:{fundamental:15,value:5,quality:10,growth:5,technical:50,liquidity:15,trapPenalty:10} },
  lowVol: { label:'低ボラ', maxVolatility:45, minDrawdown:-10, minQuality:55, weights:{fundamental:20,value:10,quality:20,growth:5,technical:20,liquidity:25,trapPenalty:20} },
  freeSafe: { label:'Free安全運用', minCompleteness:45, minQuality:60, maxTrap:40, minTechnical:55, missingPolicy:'exclude', topN:10, weights:{fundamental:25,value:10,quality:25,growth:5,technical:20,liquidity:15,trapPenalty:25} },
});

const num = value => {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};
const clamp = value => Math.max(0, Math.min(100, value));

export function applyPreset(name, current = DEFAULT_SCREENING_CONFIG) {
  const preset = SCREENING_PRESETS[name] ?? SCREENING_PRESETS.balanced;
  return {
    ...structuredClone(DEFAULT_SCREENING_CONFIG),
    ...current,
    ...preset,
    preset: name,
    weights: { ...DEFAULT_SCREENING_CONFIG.weights, ...(preset.weights ?? {}) },
  };
}

export function mergeScreeningData(rankingPayload, reportPayload) {
  const decisions = new Map((reportPayload?.decisions ?? []).map(item => [String(item.code), item]));
  return (rankingPayload?.rows ?? []).map(row => {
    const code = String(row.code ?? row.symbol ?? '').replace(/\.T$/i, '').replace(/0$/, match => String(row.code ?? '').length === 5 ? '' : match);
    const decision = decisions.get(code) ?? {};
    const fundamental = decision.fundamental ?? {};
    const technical = decision.technical ?? {};
    const holding = decision.holding ?? {};
    return {
      ...row,
      code,
      company_name: row.company_name ?? decision.company_name ?? code,
      market: row.market ?? '',
      sector: row.sector ?? '',
      overall_score: num(row.overall_score),
      fundamental_score: num(fundamental.score ?? row.fundamental_score),
      value_score: num(fundamental.value_score ?? row.value_score),
      quality_score: num(fundamental.quality_score ?? row.quality_score),
      growth_score: num(fundamental.growth_stability_score ?? row.growth_stability_score),
      technical_score: num(technical.score ?? row.technical_score),
      liquidity_score: num(row.liquidity_score),
      value_trap_risk: num(fundamental.value_trap_risk ?? row.value_trap_risk),
      data_completeness: num(fundamental.data_completeness ?? row.data_completeness),
      rsi14: num(technical.rsi14),
      price: num(technical.price ?? row.last_price),
      sma20: num(technical.sma20),
      sma60: num(technical.sma60),
      momentum20: num(technical.momentum20_pct),
      momentum60: num(technical.momentum60_pct),
      volatility20: num(technical.volatility20_pct),
      drawdown20: num(technical.drawdown20_pct),
      trading_value: num(technical.trading_value20 ?? row.average_daily_value),
      holding_quantity: num(holding.quantity) ?? 0,
      action: decision.decision?.action ?? 'WATCH',
      positive_reasons: decision.decision?.reasons ?? [],
      risk_reasons: decision.decision?.risks ?? [],
    };
  });
}

function missingValue(value, policy, neutral = 50) {
  if (value !== null) return { value, missing:false, excluded:false };
  if (policy === 'exclude') return { value:null, missing:true, excluded:true };
  if (policy === 'neutral') return { value:neutral, missing:true, excluded:false };
  return { value:null, missing:true, excluded:false };
}

export function recomputeScore(record, config) {
  const weights = config.weights ?? DEFAULT_SCREENING_CONFIG.weights;
  const components = [
    ['fundamental', record.fundamental_score],
    ['value', record.value_score],
    ['quality', record.quality_score],
    ['growth', record.growth_score],
    ['technical', record.technical_score],
    ['liquidity', record.liquidity_score],
  ];
  let weighted = 0;
  let denominator = 0;
  const contributions = {};
  const missing = [];
  let excluded = false;
  for (const [name, raw] of components) {
    const resolved = missingValue(raw, config.missingPolicy);
    if (resolved.excluded) excluded = true;
    if (resolved.missing) missing.push(name);
    const weight = Math.max(0, Number(weights[name] ?? 0));
    if (resolved.value !== null && weight > 0) {
      const contribution = resolved.value * weight;
      weighted += contribution;
      denominator += weight;
      contributions[name] = contribution;
    } else contributions[name] = null;
  }
  const trap = missingValue(record.value_trap_risk, config.missingPolicy, 50);
  if (trap.excluded) excluded = true;
  if (trap.missing) missing.push('value_trap_risk');
  const trapWeight = Math.max(0, Number(weights.trapPenalty ?? 0));
  if (trap.value !== null && trapWeight > 0) {
    const safety = 100 - trap.value;
    weighted += safety * trapWeight;
    denominator += trapWeight;
    contributions.trapSafety = safety * trapWeight;
  } else contributions.trapSafety = null;
  const score = denominator ? clamp(weighted / denominator) : null;
  return { score, contributions, missing, excluded };
}

export function evaluateRecord(record, config) {
  const reasons = [];
  const missingRequired = [];
  const requireMin = (field, threshold, label) => {
    const value = num(record[field]);
    if (value === null) missingRequired.push(label);
    else if (value < Number(threshold)) reasons.push(`${label} ${value.toFixed(1)} < ${Number(threshold).toFixed(1)}`);
  };
  requireMin('overall_score', config.minOverall, '総合');
  requireMin('fundamental_score', config.minFundamental, 'Fundamental');
  requireMin('value_score', config.minValue, '割安');
  requireMin('quality_score', config.minQuality, '品質');
  requireMin('growth_score', config.minGrowth, '成長');
  requireMin('data_completeness', config.minCompleteness, '充足率');
  requireMin('technical_score', config.minTechnical, 'Technical');
  const trap = num(record.value_trap_risk);
  if (trap === null) missingRequired.push('Trap');
  else if (trap > Number(config.maxTrap)) reasons.push(`Trap ${trap.toFixed(1)} > ${Number(config.maxTrap).toFixed(1)}`);
  const rsi = num(record.rsi14);
  if (rsi !== null && (rsi < Number(config.minRsi) || rsi > Number(config.maxRsi))) reasons.push(`RSI ${rsi.toFixed(1)} が範囲外`);
  if (config.requirePriceAboveSma20) {
    if (record.price === null || record.sma20 === null) missingRequired.push('価格/SMA20');
    else if (record.price <= record.sma20) reasons.push('株価がSMA20以下');
  }
  if (config.requireSma20AboveSma60) {
    if (record.sma20 === null || record.sma60 === null) missingRequired.push('SMA20/SMA60');
    else if (record.sma20 <= record.sma60) reasons.push('SMA20がSMA60以下');
  }
  if (record.momentum20 !== null && record.momentum20 < Number(config.minMomentum20)) reasons.push('20日Momentum不足');
  if (record.momentum60 !== null && record.momentum60 < Number(config.minMomentum60)) reasons.push('60日Momentum不足');
  if (record.volatility20 !== null && record.volatility20 > Number(config.maxVolatility)) reasons.push('Volatility超過');
  if (record.drawdown20 !== null && record.drawdown20 < Number(config.minDrawdown)) reasons.push('Drawdown超過');
  if (config.market && record.market !== config.market) reasons.push('市場不一致');
  if (config.sector && record.sector !== config.sector) reasons.push('業種不一致');
  if (config.holding === 'held' && record.holding_quantity <= 0) reasons.push('未保有');
  if (config.holding === 'unheld' && record.holding_quantity > 0) reasons.push('保有中');
  if (config.action !== 'all' && record.action !== config.action) reasons.push('判断不一致');
  if (record.trading_value !== null && record.trading_value < Number(config.minTradingValue)) reasons.push('売買代金不足');
  const score = recomputeScore(record, config);
  if (score.excluded) missingRequired.push(...score.missing);
  if (config.missingPolicy === 'exclude' && missingRequired.length) reasons.push(`欠損: ${[...new Set(missingRequired)].join(', ')}`);
  return { ...record, lab_score: score.score, contributions: score.contributions, missing: score.missing, included: reasons.length === 0, exclusion_reasons: reasons };
}

export function screenRecords(records, config) {
  const evaluated = records.map(record => evaluateRecord(record, config));
  const included = evaluated.filter(record => record.included).sort((a,b) => (b.lab_score ?? -1) - (a.lab_score ?? -1) || String(a.code).localeCompare(String(b.code),'ja',{numeric:true}));
  const topN = Math.max(1, Number(config.topN ?? 20));
  return { included: included.slice(0, topN), excluded: evaluated.filter(record => !record.included), evaluated };
}

export function screeningRowsToCsv(rows) {
  const columns = ['code','company_name','market','sector','lab_score','overall_score','fundamental_score','value_score','quality_score','growth_score','technical_score','liquidity_score','value_trap_risk','data_completeness','rsi14','momentum20','momentum60','volatility20','drawdown20','action','holding_quantity','exclusion_reasons'];
  const escape = value => { const text = Array.isArray(value) ? value.join(' / ') : String(value ?? ''); return /[",\n]/.test(text) ? `"${text.replaceAll('"','""')}"` : text; };
  return [columns.join(','), ...rows.map(row => columns.map(column => escape(row[column])).join(','))].join('\n');
}

export function encodeConfig(config) {
  return btoa(unescape(encodeURIComponent(JSON.stringify(config)))).replaceAll('+','-').replaceAll('/','_').replaceAll('=','');
}
export function decodeConfig(value) {
  try { const normalized = value.replaceAll('-','+').replaceAll('_','/'); return JSON.parse(decodeURIComponent(escape(atob(normalized)))); } catch { return null; }
}
