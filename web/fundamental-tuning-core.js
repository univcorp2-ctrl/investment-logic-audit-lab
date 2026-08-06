export const DEFAULT_FUNDAMENTAL_CONFIG = Object.freeze({
  preset: 'balanced',
  minValueScore: 0,
  minQualityScore: 0,
  minGrowthScore: 0,
  maxTrapRisk: 100,
  minCompleteness: 0,
  minEarningsYieldPct: -100,
  minBookToMarketPct: -100,
  minFcfYieldPct: -100,
  minRoePct: -100,
  minOperatingMarginPct: -100,
  maxDisclosureAgeDays: 9999,
  missingPolicy: 'allow',
  weights: { value: 30, quality: 30, growth: 15, trapSafety: 15, completeness: 10 },
});

export const FUNDAMENTAL_PRESETS = Object.freeze({
  balanced: { label:'バランス', minCompleteness:35, maxTrapRisk:60, weights:{value:30,quality:30,growth:15,trapSafety:15,completeness:10} },
  value: { label:'割安', minValueScore:65, minEarningsYieldPct:1, minBookToMarketPct:20, maxTrapRisk:55, weights:{value:45,quality:20,growth:5,trapSafety:20,completeness:10} },
  quality: { label:'品質', minQualityScore:70, minRoePct:5, minOperatingMarginPct:5, maxTrapRisk:45, minCompleteness:45, weights:{value:15,quality:45,growth:15,trapSafety:15,completeness:10} },
  cashflow: { label:'CF重視', minFcfYieldPct:0, minQualityScore:55, maxTrapRisk:50, weights:{value:25,quality:30,growth:10,trapSafety:25,completeness:10} },
  conservative: { label:'保守的', minQualityScore:65, minCompleteness:55, maxTrapRisk:35, minRoePct:5, minOperatingMarginPct:3, maxDisclosureAgeDays:240, missingPolicy:'exclude', weights:{value:20,quality:35,growth:10,trapSafety:25,completeness:10} },
});

const num = value => {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};
const pct = value => value === null ? null : value * 100;

export function applyFundamentalPreset(name, current = DEFAULT_FUNDAMENTAL_CONFIG) {
  const preset = FUNDAMENTAL_PRESETS[name] ?? FUNDAMENTAL_PRESETS.balanced;
  return {
    ...structuredClone(DEFAULT_FUNDAMENTAL_CONFIG),
    ...current,
    ...preset,
    preset: name,
    weights: { ...DEFAULT_FUNDAMENTAL_CONFIG.weights, ...(preset.weights ?? {}) },
  };
}

export function fundamentalRecords(report, now = new Date()) {
  return (report?.decisions ?? []).map(item => {
    const f = item.fundamental ?? {};
    const disclosed = f.latest_disclosure_date ? new Date(f.latest_disclosure_date) : null;
    const ageDays = disclosed && !Number.isNaN(disclosed.getTime()) ? Math.max(0, (now.getTime() - disclosed.getTime()) / 86400000) : null;
    return {
      code: item.code,
      company_name: item.company_name,
      value_score: num(f.value_score),
      quality_score: num(f.quality_score),
      growth_score: num(f.growth_stability_score),
      trap_risk: num(f.value_trap_risk),
      completeness: num(f.data_completeness),
      earnings_yield_pct: pct(num(f.earnings_yield)),
      book_to_market_pct: pct(num(f.book_to_market)),
      fcf_yield_pct: pct(num(f.fcf_yield)),
      roe_pct: pct(num(f.roe)),
      operating_margin_pct: pct(num(f.operating_margin)),
      disclosure_age_days: ageDays,
      latest_disclosure_date: f.latest_disclosure_date ?? null,
      missing: Array.isArray(f.missing) ? f.missing : [],
      source_positive_reasons: f.source_positive_reasons ?? '',
      source_negative_reasons: f.source_negative_reasons ?? '',
    };
  });
}

function resolve(value, policy, neutral = 50) {
  if (value !== null) return {value, missing:false, excluded:false};
  if (policy === 'exclude') return {value:null, missing:true, excluded:true};
  if (policy === 'neutral') return {value:neutral, missing:true, excluded:false};
  return {value:null, missing:true, excluded:false};
}

export function fundamentalComposite(record, config) {
  const parts = [
    ['value', record.value_score],
    ['quality', record.quality_score],
    ['growth', record.growth_score],
    ['trapSafety', record.trap_risk === null ? null : 100 - record.trap_risk],
    ['completeness', record.completeness],
  ];
  let numerator = 0;
  let denominator = 0;
  let excluded = false;
  const missing = [];
  const contributions = {};
  for (const [name, raw] of parts) {
    const resolved = resolve(raw, config.missingPolicy);
    if (resolved.excluded) excluded = true;
    if (resolved.missing) missing.push(name);
    const weight = Math.max(0, Number(config.weights?.[name] ?? 0));
    if (resolved.value !== null && weight > 0) {
      numerator += resolved.value * weight;
      denominator += weight;
      contributions[name] = resolved.value * weight;
    } else contributions[name] = null;
  }
  return { score: denominator ? numerator / denominator : null, excluded, missing, contributions };
}

export function evaluateFundamental(record, config) {
  const reasons = [];
  const missing = [];
  const checkMin = (field, threshold, label) => {
    const value = record[field];
    if (value === null) missing.push(label);
    else if (value < Number(threshold)) reasons.push(`${label} ${value.toFixed(2)} < ${Number(threshold).toFixed(2)}`);
  };
  checkMin('value_score', config.minValueScore, '割安スコア');
  checkMin('quality_score', config.minQualityScore, '品質スコア');
  checkMin('growth_score', config.minGrowthScore, '成長スコア');
  checkMin('completeness', config.minCompleteness, 'データ充足率');
  checkMin('earnings_yield_pct', config.minEarningsYieldPct, '利益利回り%');
  checkMin('book_to_market_pct', config.minBookToMarketPct, '純資産/時価%');
  checkMin('fcf_yield_pct', config.minFcfYieldPct, 'FCF利回り%');
  checkMin('roe_pct', config.minRoePct, 'ROE%');
  checkMin('operating_margin_pct', config.minOperatingMarginPct, '営業利益率%');
  if (record.trap_risk === null) missing.push('Value Trap');
  else if (record.trap_risk > Number(config.maxTrapRisk)) reasons.push(`Value Trap ${record.trap_risk.toFixed(1)} > ${Number(config.maxTrapRisk).toFixed(1)}`);
  if (record.disclosure_age_days === null) missing.push('開示日');
  else if (record.disclosure_age_days > Number(config.maxDisclosureAgeDays)) reasons.push(`開示から${Math.round(record.disclosure_age_days)}日 > ${Number(config.maxDisclosureAgeDays)}日`);
  const composite = fundamentalComposite(record, config);
  if (composite.excluded) missing.push(...composite.missing);
  if (config.missingPolicy === 'exclude' && missing.length) reasons.push(`欠損: ${[...new Set(missing)].join(', ')}`);
  return { ...record, user_fundamental_score: composite.score, included: reasons.length === 0, exclusion_reasons: reasons, composite_missing: composite.missing };
}

export function screenFundamentals(records, config) {
  const evaluated = records.map(record => evaluateFundamental(record, config));
  return {
    included: evaluated.filter(row => row.included).sort((a,b) => (b.user_fundamental_score ?? -1) - (a.user_fundamental_score ?? -1)),
    excluded: evaluated.filter(row => !row.included),
  };
}
