import test from 'node:test';
import assert from 'node:assert/strict';
import {
  FONT_SCALES,
  applyParameterPreset,
  defaultParameterBundle,
  fontSizePx,
  getPath,
  normalizeParameterBundle,
  parameterWarnings,
  parseParameterBundle,
  serializeParameterBundle,
  setPath,
} from '../parameter-control-center-core.js';

test('default bundle starts with readable large font', () => {
  const bundle = defaultParameterBundle();
  assert.equal(bundle.ui.fontScale, 'large');
  assert.equal(fontSizePx(bundle.ui.fontScale), 18);
  assert.equal(FONT_SCALES.xlarge.px, 20);
});

test('conservative preset tightens risk and quality controls', () => {
  const bundle = applyParameterPreset('conservative', defaultParameterBundle());
  assert.ok(bundle.screening.minQuality >= 60);
  assert.ok(bundle.fundamental.minQualityScore >= 60);
  assert.ok(bundle.risk.maxPortfolioDrawdownPct <= 6);
  assert.ok(bundle.risk.maxPositionWeightPct <= 15);
});

test('normalization clamps invalid settings', () => {
  const bundle = normalizeParameterBundle({ screening:{minQuality:999,minRsi:80,maxRsi:20}, risk:{maxPortfolioDrawdownPct:-1}, ui:{fontScale:'tiny'} });
  assert.equal(bundle.screening.minQuality, 100);
  assert.equal(bundle.risk.maxPortfolioDrawdownPct, 8);
  assert.equal(bundle.ui.fontScale, 'large');
  assert.match(parameterWarnings(bundle).join(' '), /RSI/);
});

test('path helpers update nested parameter values', () => {
  const bundle = defaultParameterBundle();
  setPath(bundle, 'fundamental.minRoePct', 12.5);
  assert.equal(getPath(bundle, 'fundamental.minRoePct'), 12.5);
});

test('export and import preserve user settings', () => {
  const bundle = defaultParameterBundle();
  bundle.screening.minQuality = 72;
  bundle.ui.fontScale = 'xlarge';
  const parsed = parseParameterBundle(serializeParameterBundle(bundle));
  assert.equal(parsed.screening.minQuality, 72);
  assert.equal(parsed.ui.fontScale, 'xlarge');
});
