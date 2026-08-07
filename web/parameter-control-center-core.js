import { DEFAULT_SCREENING_CONFIG, applyPreset } from './screening-lab-core.js';
import { DEFAULT_FUNDAMENTAL_CONFIG, applyFundamentalPreset } from './fundamental-tuning-core.js';
import { DEFAULT_RISK_POLICY, normalizeRiskPolicy } from './risk-diagnostics-core.js';

export const PARAMETER_STORAGE_KEYS = Object.freeze({
  bundle: 'valuescope-parameter-center-v1',
  screening: 'valuescope-screening-lab-v1',
  fundamental: 'valuescope-fundamental-tuning-v1',
  risk: 'valuescope-risk-policy-v1',
  density: 'valuescope-density-v1',
  ui: 'valuescope-ui-preferences-v1',
});

export const FONT_SCALES = Object.freeze({
  standard: { label: '標準', px: 16 },
  large: { label: '大きめ', px: 18 },
  xlarge: { label: '最大', px: 20 },
});

export const DEFAULT_UI_PREFERENCES = Object.freeze({
  fontScale: 'large',
  density: 'comfortable',
  highContrast: false,
});

export const PARAMETER_PRESETS = Object.freeze({
  balanced: { label: 'バランス', description: 'FundamentalとTechnicalを均等に確認' },
  conservative: { label: '保守的', description: '品質・データ充足率・損失上限を厳しくする' },
  value: { label: '割安重視', description: '割安性とTrap安全性を重視' },
  trend: { label: '順張り', description: '移動平均とモメンタム確認を重視' },
  lowVol: { label: '低ボラ', description: '変動率・集中・ドローダウンを抑える' },
});

const clone = value => structuredClone(value);
const finite = (value, fallback) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const clamp = (value, min, max, fallback) => Math.max(min, Math.min(max, finite(value, fallback)));

function mergeScreening(value = {}) {
  const defaults = clone(DEFAULT_SCREENING_CONFIG);
  return {
    ...defaults,
    ...value,
    minOverall: clamp(value.minOverall, 0, 100, defaults.minOverall),
    minFundamental: clamp(value.minFundamental, 0, 100, defaults.minFundamental),
    minValue: clamp(value.minValue, 0, 100, defaults.minValue),
    minQuality: clamp(value.minQuality, 0, 100, defaults.minQuality),
    minGrowth: clamp(value.minGrowth, 0, 100, defaults.minGrowth),
    minCompleteness: clamp(value.minCompleteness, 0, 100, defaults.minCompleteness),
    minTechnical: clamp(value.minTechnical, 0, 100, defaults.minTechnical),
    maxTrap: clamp(value.maxTrap, 0, 100, defaults.maxTrap),
    minRsi: clamp(value.minRsi, 0, 100, defaults.minRsi),
    maxRsi: clamp(value.maxRsi, 0, 100, defaults.maxRsi),
    minMomentum20: clamp(value.minMomentum20, -100, 100, defaults.minMomentum20),
    minMomentum60: clamp(value.minMomentum60, -100, 100, defaults.minMomentum60),
    maxVolatility: clamp(value.maxVolatility, 1, 999, defaults.maxVolatility),
    minDrawdown: clamp(value.minDrawdown, -100, 0, defaults.minDrawdown),
    topN: clamp(value.topN, 1, 100, defaults.topN),
    missingPolicy: ['allow', 'neutral', 'exclude'].includes(value.missingPolicy) ? value.missingPolicy : defaults.missingPolicy,
    weights: {
      ...defaults.weights,
      ...(value.weights ?? {}),
    },
  };
}

function mergeFundamental(value = {}) {
  const defaults = clone(DEFAULT_FUNDAMENTAL_CONFIG);
  return {
    ...defaults,
    ...value,
    minValueScore: clamp(value.minValueScore, 0, 100, defaults.minValueScore),
    minQualityScore: clamp(value.minQualityScore, 0, 100, defaults.minQualityScore),
    minGrowthScore: clamp(value.minGrowthScore, 0, 100, defaults.minGrowthScore),
    maxTrapRisk: clamp(value.maxTrapRisk, 0, 100, defaults.maxTrapRisk),
    minCompleteness: clamp(value.minCompleteness, 0, 100, defaults.minCompleteness),
    minEarningsYieldPct: clamp(value.minEarningsYieldPct, -100, 100, defaults.minEarningsYieldPct),
    minBookToMarketPct: clamp(value.minBookToMarketPct, -100, 300, defaults.minBookToMarketPct),
    minFcfYieldPct: clamp(value.minFcfYieldPct, -100, 100, defaults.minFcfYieldPct),
    minRoePct: clamp(value.minRoePct, -100, 100, defaults.minRoePct),
    minOperatingMarginPct: clamp(value.minOperatingMarginPct, -100, 100, defaults.minOperatingMarginPct),
    maxDisclosureAgeDays: clamp(value.maxDisclosureAgeDays, 1, 9999, defaults.maxDisclosureAgeDays),
    missingPolicy: ['allow', 'neutral', 'exclude'].includes(value.missingPolicy) ? value.missingPolicy : defaults.missingPolicy,
    weights: {
      ...defaults.weights,
      ...(value.weights ?? {}),
    },
  };
}

export function defaultParameterBundle() {
  return {
    schemaVersion: 1,
    preset: 'balanced',
    screening: mergeScreening(applyPreset('balanced', clone(DEFAULT_SCREENING_CONFIG))),
    fundamental: mergeFundamental(applyFundamentalPreset('balanced', clone(DEFAULT_FUNDAMENTAL_CONFIG))),
    risk: normalizeRiskPolicy(clone(DEFAULT_RISK_POLICY)),
    ui: clone(DEFAULT_UI_PREFERENCES),
  };
}

export function normalizeParameterBundle(value = {}) {
  const defaults = defaultParameterBundle();
  const fontScale = Object.hasOwn(FONT_SCALES, value?.ui?.fontScale) ? value.ui.fontScale : defaults.ui.fontScale;
  return {
    schemaVersion: 1,
    preset: Object.hasOwn(PARAMETER_PRESETS, value.preset) ? value.preset : 'custom',
    screening: mergeScreening(value.screening ?? defaults.screening),
    fundamental: mergeFundamental(value.fundamental ?? defaults.fundamental),
    risk: normalizeRiskPolicy(value.risk ?? defaults.risk),
    ui: {
      ...defaults.ui,
      ...(value.ui ?? {}),
      fontScale,
      density: value?.ui?.density === 'compact' ? 'compact' : 'comfortable',
      highContrast: Boolean(value?.ui?.highContrast),
    },
  };
}

export function applyParameterPreset(name, current = defaultParameterBundle()) {
  const base = normalizeParameterBundle(current);
  if (name === 'conservative') {
    return normalizeParameterBundle({
      ...base,
      preset: name,
      screening: applyPreset('freeSafe', base.screening),
      fundamental: applyFundamentalPreset('conservative', base.fundamental),
      risk: { ...base.risk, maxPortfolioDrawdownPct: 6, maxTotalUnrealizedLossPct: 4, maxPositionLossPct: 6, maxPositionWeightPct: 15 },
    });
  }
  if (name === 'value') {
    return normalizeParameterBundle({ ...base, preset: name, screening: applyPreset('value', base.screening), fundamental: applyFundamentalPreset('value', base.fundamental) });
  }
  if (name === 'trend') {
    return normalizeParameterBundle({ ...base, preset: name, screening: applyPreset('trend', base.screening), fundamental: applyFundamentalPreset('quality', base.fundamental) });
  }
  if (name === 'lowVol') {
    return normalizeParameterBundle({
      ...base,
      preset: name,
      screening: applyPreset('lowVol', base.screening),
      fundamental: applyFundamentalPreset('conservative', base.fundamental),
      risk: { ...base.risk, maxPortfolioDrawdownPct: 6, maxPositionWeightPct: 15 },
    });
  }
  return normalizeParameterBundle({
    ...base,
    preset: 'balanced',
    screening: applyPreset('balanced', base.screening),
    fundamental: applyFundamentalPreset('balanced', base.fundamental),
    risk: clone(DEFAULT_RISK_POLICY),
  });
}

export function fontSizePx(scale) {
  return FONT_SCALES[scale]?.px ?? FONT_SCALES.large.px;
}

export function getPath(object, path) {
  return String(path).split('.').reduce((value, key) => value?.[key], object);
}

export function setPath(object, path, value) {
  const keys = String(path).split('.');
  let target = object;
  for (const key of keys.slice(0, -1)) {
    if (!target[key] || typeof target[key] !== 'object') target[key] = {};
    target = target[key];
  }
  target[keys.at(-1)] = value;
  return object;
}

export function parameterWarnings(bundleInput) {
  const bundle = normalizeParameterBundle(bundleInput);
  const warnings = [];
  const screeningWeight = Object.values(bundle.screening.weights).reduce((sum, value) => sum + Math.max(0, Number(value) || 0), 0);
  const fundamentalWeight = Object.values(bundle.fundamental.weights).reduce((sum, value) => sum + Math.max(0, Number(value) || 0), 0);
  if (screeningWeight === 0) warnings.push('スクリーニング再計算ウェイトがすべて0です。');
  if (fundamentalWeight === 0) warnings.push('Fundamental再計算ウェイトがすべて0です。');
  if (bundle.screening.minRsi > bundle.screening.maxRsi) warnings.push('最低RSIが最大RSIを上回っています。');
  if (bundle.risk.maxPositionLossPct > bundle.risk.maxTotalUnrealizedLossPct * 2) warnings.push('1銘柄損失上限が全体損失上限に対して大きすぎます。');
  return warnings;
}

export function serializeParameterBundle(bundle) {
  return JSON.stringify(normalizeParameterBundle(bundle), null, 2);
}

export function parseParameterBundle(text) {
  return normalizeParameterBundle(JSON.parse(text));
}
