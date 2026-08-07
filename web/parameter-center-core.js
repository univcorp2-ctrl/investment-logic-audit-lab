export const PARAMETER_STORAGE_KEY = 'valuescope-user-parameters-v2';
export const PARAMETER_VERSION = 2;

export const DEFAULT_USER_PARAMETERS = Object.freeze({
  version: PARAMETER_VERSION,
  selection: {
    minOverall: 0,
    minCompleteness: 35,
    topN: 20,
    market: '',
    sector: '',
    missingPolicy: 'allow',
  },
  fundamental: {
    minValue: 0,
    minQuality: 0,
    minGrowth: 0,
    maxTrap: 60,
    minEarningsYieldPct: -10,
    minBookToMarketPct: -20,
    minFcfYieldPct: -20,
    minRoePct: -30,
    minOperatingMarginPct: -30,
    maxDisclosureAgeDays: 999,
    weights: { value: 30, quality: 30, growth: 15, trapSafety: 15, completeness: 10 },
  },
  technical: {
    minScore: 45,
    minRsi: 0,
    maxRsi: 100,
    requirePriceAboveSma20: false,
    requireSma20AboveSma60: false,
    minMomentum20: -50,
    minMomentum60: -80,
    maxVolatility: 200,
    minDrawdown: -50,
  },
  risk: {
    maxPortfolioDrawdownPct: 8,
    maxTotalUnrealizedLossPct: 5,
    maxTotalUnrealizedLossYen: 1_500_000,
    maxPositionLossPct: 8,
    maxPositionLossYen: 500_000,
    maxPositionWeightPct: 20,
    maxSectorWeightPct: 35,
  },
  display: {
    fontScale: 'standard',
    density: 'comfortable',
    highContrast: false,
  },
});

export const PARAMETER_PRESETS = Object.freeze({
  balanced: {
    label: 'バランス',
    patch: {
      selection: { minCompleteness: 35, topN: 20, missingPolicy: 'allow' },
      fundamental: { minValue: 45, minQuality: 50, minGrowth: 40, maxTrap: 60, weights: { value: 30, quality: 30, growth: 15, trapSafety: 15, completeness: 10 } },
      technical: { minScore: 45, minRsi: 0, maxRsi: 100, requirePriceAboveSma20: false, requireSma20AboveSma60: false },
      risk: { maxPortfolioDrawdownPct: 8, maxTotalUnrealizedLossPct: 5, maxPositionLossPct: 8, maxPositionWeightPct: 20, maxSectorWeightPct: 35 },
    },
  },
  value: {
    label: '割安重視',
    patch: {
      selection: { minCompleteness: 35, topN: 20 },
      fundamental: { minValue: 65, minQuality: 45, minGrowth: 20, maxTrap: 55, minEarningsYieldPct: 1, minBookToMarketPct: 20, weights: { value: 45, quality: 20, growth: 5, trapSafety: 20, completeness: 10 } },
      technical: { minScore: 35 },
    },
  },
  quality: {
    label: '品質重視',
    patch: {
      selection: { minCompleteness: 45, topN: 15 },
      fundamental: { minValue: 30, minQuality: 70, minGrowth: 50, maxTrap: 45, minRoePct: 5, minOperatingMarginPct: 5, weights: { value: 15, quality: 45, growth: 15, trapSafety: 15, completeness: 10 } },
      technical: { minScore: 40 },
    },
  },
  trend: {
    label: '順張り',
    patch: {
      selection: { minCompleteness: 30, topN: 15 },
      fundamental: { minValue: 20, minQuality: 45, minGrowth: 30, maxTrap: 65, weights: { value: 15, quality: 20, growth: 10, trapSafety: 10, completeness: 5 } },
      technical: { minScore: 65, minRsi: 45, maxRsi: 75, requirePriceAboveSma20: true, requireSma20AboveSma60: true, minMomentum20: 0, minMomentum60: 0, maxVolatility: 90, minDrawdown: -15 },
    },
  },
  lowVol: {
    label: '低ボラ',
    patch: {
      selection: { minCompleteness: 40, topN: 15 },
      fundamental: { minValue: 30, minQuality: 60, minGrowth: 35, maxTrap: 50, weights: { value: 20, quality: 35, growth: 10, trapSafety: 25, completeness: 10 } },
      technical: { minScore: 50, minRsi: 35, maxRsi: 70, maxVolatility: 45, minDrawdown: -10 },
      risk: { maxPortfolioDrawdownPct: 6, maxTotalUnrealizedLossPct: 4, maxPositionLossPct: 6, maxPositionWeightPct: 15, maxSectorWeightPct: 30 },
    },
  },
  conservative: {
    label: '保守運用',
    patch: {
      selection: { minCompleteness: 55, topN: 10, missingPolicy: 'exclude' },
      fundamental: { minValue: 35, minQuality: 65, minGrowth: 45, maxTrap: 35, minFcfYieldPct: 0, minRoePct: 5, minOperatingMarginPct: 3, maxDisclosureAgeDays: 240, weights: { value: 20, quality: 35, growth: 10, trapSafety: 25, completeness: 10 } },
      technical: { minScore: 55, minRsi: 35, maxRsi: 72, requirePriceAboveSma20: true, minMomentum20: -3, minMomentum60: -5, maxVolatility: 60, minDrawdown: -12 },
      risk: { maxPortfolioDrawdownPct: 5, maxTotalUnrealizedLossPct: 3, maxTotalUnrealizedLossYen: 900_000, maxPositionLossPct: 5, maxPositionLossYen: 300_000, maxPositionWeightPct: 15, maxSectorWeightPct: 25 },
    },
  },
});

const clone = value => JSON.parse(JSON.stringify(value));
const number = (value, fallback) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};
const clamp = (value, min, max, fallback) => Math.min(max, Math.max(min, number(value, fallback)));

function mergeDeep(base, patch) {
  const output = clone(base);
  for (const [key, value] of Object.entries(patch ?? {})) {
    if (value && typeof value === 'object' && !Array.isArray(value) && output[key] && typeof output[key] === 'object') output[key] = mergeDeep(output[key], value);
    else output[key] = value;
  }
  return output;
}

export function normalizeWeights(weights, defaults) {
  const keys = Object.keys(defaults);
  const sanitized = Object.fromEntries(keys.map(key => [key, Math.max(0, number(weights?.[key], defaults[key]))]));
  const total = Object.values(sanitized).reduce((sum, value) => sum + value, 0);
  if (total <= 0) return normalizeWeights(defaults, defaults);
  const normalized = {};
  let used = 0;
  keys.forEach((key, index) => {
    const value = index === keys.length - 1 ? 100 - used : Math.round(sanitized[key] / total * 10000) / 100;
    normalized[key] = Math.max(0, Math.round(value * 100) / 100);
    used += normalized[key];
  });
  return normalized;
}

export function normalizeParameters(input = {}) {
  const merged = mergeDeep(DEFAULT_USER_PARAMETERS, input);
  const output = {
    version: PARAMETER_VERSION,
    selection: {
      minOverall: clamp(merged.selection.minOverall, 0, 100, 0),
      minCompleteness: clamp(merged.selection.minCompleteness, 0, 100, 35),
      topN: Math.round(clamp(merged.selection.topN, 1, 100, 20)),
      market: String(merged.selection.market ?? ''),
      sector: String(merged.selection.sector ?? ''),
      missingPolicy: ['allow', 'neutral', 'exclude'].includes(merged.selection.missingPolicy) ? merged.selection.missingPolicy : 'allow',
    },
    fundamental: {
      minValue: clamp(merged.fundamental.minValue, 0, 100, 0),
      minQuality: clamp(merged.fundamental.minQuality, 0, 100, 0),
      minGrowth: clamp(merged.fundamental.minGrowth, 0, 100, 0),
      maxTrap: clamp(merged.fundamental.maxTrap, 0, 100, 60),
      minEarningsYieldPct: clamp(merged.fundamental.minEarningsYieldPct, -100, 100, -10),
      minBookToMarketPct: clamp(merged.fundamental.minBookToMarketPct, -100, 500, -20),
      minFcfYieldPct: clamp(merged.fundamental.minFcfYieldPct, -100, 100, -20),
      minRoePct: clamp(merged.fundamental.minRoePct, -100, 100, -30),
      minOperatingMarginPct: clamp(merged.fundamental.minOperatingMarginPct, -100, 100, -30),
      maxDisclosureAgeDays: Math.round(clamp(merged.fundamental.maxDisclosureAgeDays, 1, 3650, 999)),
      weights: normalizeWeights(merged.fundamental.weights, DEFAULT_USER_PARAMETERS.fundamental.weights),
    },
    technical: {
      minScore: clamp(merged.technical.minScore, 0, 100, 45),
      minRsi: clamp(merged.technical.minRsi, 0, 100, 0),
      maxRsi: clamp(merged.technical.maxRsi, 0, 100, 100),
      requirePriceAboveSma20: Boolean(merged.technical.requirePriceAboveSma20),
      requireSma20AboveSma60: Boolean(merged.technical.requireSma20AboveSma60),
      minMomentum20: clamp(merged.technical.minMomentum20, -100, 200, -50),
      minMomentum60: clamp(merged.technical.minMomentum60, -100, 300, -80),
      maxVolatility: clamp(merged.technical.maxVolatility, 1, 500, 200),
      minDrawdown: clamp(merged.technical.minDrawdown, -100, 0, -50),
    },
    risk: {
      maxPortfolioDrawdownPct: clamp(merged.risk.maxPortfolioDrawdownPct, 0.5, 100, 8),
      maxTotalUnrealizedLossPct: clamp(merged.risk.maxTotalUnrealizedLossPct, 0.5, 100, 5),
      maxTotalUnrealizedLossYen: Math.round(clamp(merged.risk.maxTotalUnrealizedLossYen, 10_000, 100_000_000, 1_500_000)),
      maxPositionLossPct: clamp(merged.risk.maxPositionLossPct, 0.5, 100, 8),
      maxPositionLossYen: Math.round(clamp(merged.risk.maxPositionLossYen, 10_000, 100_000_000, 500_000)),
      maxPositionWeightPct: clamp(merged.risk.maxPositionWeightPct, 1, 100, 20),
      maxSectorWeightPct: clamp(merged.risk.maxSectorWeightPct, 1, 100, 35),
    },
    display: {
      fontScale: ['standard', 'large', 'xlarge'].includes(merged.display.fontScale) ? merged.display.fontScale : 'standard',
      density: ['comfortable', 'compact'].includes(merged.display.density) ? merged.display.density : 'comfortable',
      highContrast: Boolean(merged.display.highContrast),
    },
  };
  return output;
}

export function validateParameters(input) {
  const config = normalizeParameters(input);
  const errors = [];
  const warnings = [];
  if (config.technical.minRsi > config.technical.maxRsi) errors.push({ field: 'technical.minRsi', code: 'rsi_range', message: 'RSI下限はRSI上限以下にしてください。' });
  if (config.risk.maxPositionWeightPct > config.risk.maxSectorWeightPct) warnings.push({ field: 'risk.maxPositionWeightPct', code: 'weight_sector', message: '1銘柄上限が業種上限を上回っています。分散効果が弱くなる可能性があります。' });
  if (config.selection.missingPolicy === 'allow' && config.selection.minCompleteness >= 60) warnings.push({ field: 'selection.missingPolicy', code: 'missing_policy', message: '充足率を厳しくする場合は欠損を「除外」にすると条件が明確です。' });
  if (config.technical.minDrawdown > 0) errors.push({ field: 'technical.minDrawdown', code: 'drawdown_sign', message: '許容ドローダウンは0%以下で指定してください。' });
  return { config, errors, warnings, valid: errors.length === 0 };
}

export function applyParameterPreset(name, current = DEFAULT_USER_PARAMETERS) {
  if (name === 'default') return clone(DEFAULT_USER_PARAMETERS);
  const preset = PARAMETER_PRESETS[name] ?? PARAMETER_PRESETS.balanced;
  return normalizeParameters(mergeDeep(current, preset.patch));
}

function flatten(value, prefix = '', output = {}) {
  for (const [key, item] of Object.entries(value ?? {})) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (item && typeof item === 'object' && !Array.isArray(item)) flatten(item, path, output);
    else output[path] = item;
  }
  return output;
}

export function countParameterChanges(input, defaults = DEFAULT_USER_PARAMETERS) {
  const current = flatten(normalizeParameters(input));
  const baseline = flatten(normalizeParameters(defaults));
  return Object.keys(baseline).filter(key => JSON.stringify(current[key]) !== JSON.stringify(baseline[key])).length;
}

export function fontScalePx(scale) {
  return ({ standard: 16, large: 18, xlarge: 20 })[scale] ?? 16;
}

export function migrateLegacyParameters(legacy = {}) {
  const screening = legacy.screening ?? {};
  const fundamental = legacy.fundamental ?? {};
  const risk = legacy.risk ?? {};
  return normalizeParameters({
    selection: {
      minOverall: screening.minOverall,
      minCompleteness: screening.minCompleteness ?? fundamental.minCompleteness,
      topN: screening.topN,
      market: screening.market,
      sector: screening.sector,
      missingPolicy: screening.missingPolicy ?? fundamental.missingPolicy,
    },
    fundamental: {
      minValue: fundamental.minValueScore ?? screening.minValue,
      minQuality: fundamental.minQualityScore ?? screening.minQuality,
      minGrowth: fundamental.minGrowthScore ?? screening.minGrowth,
      maxTrap: fundamental.maxTrapRisk ?? screening.maxTrap,
      minEarningsYieldPct: fundamental.minEarningsYieldPct,
      minBookToMarketPct: fundamental.minBookToMarketPct,
      minFcfYieldPct: fundamental.minFcfYieldPct,
      minRoePct: fundamental.minRoePct,
      minOperatingMarginPct: fundamental.minOperatingMarginPct,
      maxDisclosureAgeDays: fundamental.maxDisclosureAgeDays,
      weights: fundamental.weights,
    },
    technical: {
      minScore: screening.minTechnical,
      minRsi: screening.minRsi,
      maxRsi: screening.maxRsi,
      requirePriceAboveSma20: screening.requirePriceAboveSma20,
      requireSma20AboveSma60: screening.requireSma20AboveSma60,
      minMomentum20: screening.minMomentum20,
      minMomentum60: screening.minMomentum60,
      maxVolatility: screening.maxVolatility,
      minDrawdown: screening.minDrawdown,
    },
    risk: {
      maxPortfolioDrawdownPct: risk.maxPortfolioDrawdownPct,
      maxTotalUnrealizedLossPct: risk.maxTotalUnrealizedLossPct,
      maxTotalUnrealizedLossYen: risk.maxTotalUnrealizedLossYen,
      maxPositionLossPct: risk.maxPositionLossPct,
      maxPositionLossYen: risk.maxPositionLossYen,
      maxPositionWeightPct: risk.maxPositionWeightPct,
      maxSectorWeightPct: risk.maxSectorWeightPct,
    },
  });
}

export function legacyStoresFromParameters(input) {
  const config = normalizeParameters(input);
  return {
    screening: {
      minOverall: config.selection.minOverall,
      minCompleteness: config.selection.minCompleteness,
      topN: config.selection.topN,
      market: config.selection.market,
      sector: config.selection.sector,
      missingPolicy: config.selection.missingPolicy,
      minValue: config.fundamental.minValue,
      minQuality: config.fundamental.minQuality,
      minGrowth: config.fundamental.minGrowth,
      maxTrap: config.fundamental.maxTrap,
      minTechnical: config.technical.minScore,
      minRsi: config.technical.minRsi,
      maxRsi: config.technical.maxRsi,
      requirePriceAboveSma20: config.technical.requirePriceAboveSma20,
      requireSma20AboveSma60: config.technical.requireSma20AboveSma60,
      minMomentum20: config.technical.minMomentum20,
      minMomentum60: config.technical.minMomentum60,
      maxVolatility: config.technical.maxVolatility,
      minDrawdown: config.technical.minDrawdown,
    },
    fundamental: {
      minValueScore: config.fundamental.minValue,
      minQualityScore: config.fundamental.minQuality,
      minGrowthScore: config.fundamental.minGrowth,
      maxTrapRisk: config.fundamental.maxTrap,
      minCompleteness: config.selection.minCompleteness,
      minEarningsYieldPct: config.fundamental.minEarningsYieldPct,
      minBookToMarketPct: config.fundamental.minBookToMarketPct,
      minFcfYieldPct: config.fundamental.minFcfYieldPct,
      minRoePct: config.fundamental.minRoePct,
      minOperatingMarginPct: config.fundamental.minOperatingMarginPct,
      maxDisclosureAgeDays: config.fundamental.maxDisclosureAgeDays,
      missingPolicy: config.selection.missingPolicy,
      weights: config.fundamental.weights,
    },
    risk: { ...config.risk },
  };
}
