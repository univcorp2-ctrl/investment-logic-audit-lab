import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_USER_PARAMETERS,
  PARAMETER_PRESETS,
  applyParameterPreset,
  countParameterChanges,
  fontScalePx,
  legacyStoresFromParameters,
  migrateLegacyParameters,
  normalizeParameters,
  normalizeWeights,
  validateParameters,
} from '../parameter-center-core.js';

test('normalization clamps ranges and keeps supported display sizes', () => {
  const config = normalizeParameters({
    selection:{topN:999,minCompleteness:-3,missingPolicy:'unknown'},
    risk:{maxPositionWeightPct:-5},
    display:{fontScale:'tiny'},
  });
  assert.equal(config.selection.topN,100);
  assert.equal(config.selection.minCompleteness,0);
  assert.equal(config.selection.missingPolicy,'allow');
  assert.equal(config.risk.maxPositionWeightPct,1);
  assert.equal(config.display.fontScale,'standard');
});

test('weights are normalized to exactly 100 percent', () => {
  const weights = normalizeWeights({value:4,quality:3,growth:2,trapSafety:1,completeness:0}, DEFAULT_USER_PARAMETERS.fundamental.weights);
  const total = Object.values(weights).reduce((sum,value)=>sum+value,0);
  assert.equal(Math.round(total*100)/100,100);
  assert.equal(weights.value,40);
  assert.equal(weights.quality,30);
});

test('RSI inversion is a blocking validation error', () => {
  const result = validateParameters({technical:{minRsi:80,maxRsi:20}});
  assert.equal(result.valid,false);
  assert.ok(result.errors.some(error=>error.code==='rsi_range'));
});

test('all named presets are available and change defaults', () => {
  for (const name of ['balanced','value','quality','trend','lowVol','conservative']) {
    assert.ok(PARAMETER_PRESETS[name]);
    const config = applyParameterPreset(name, DEFAULT_USER_PARAMETERS);
    assert.ok(countParameterChanges(config)>=1);
  }
  assert.deepEqual(applyParameterPreset('default'), DEFAULT_USER_PARAMETERS);
});

test('legacy screening fundamental and risk settings migrate', () => {
  const config = migrateLegacyParameters({
    screening:{minOverall:55,minTechnical:60,minRsi:40,maxRsi:70,topN:10},
    fundamental:{minValueScore:65,minQualityScore:70,maxTrapRisk:40,minRoePct:8},
    risk:{maxPortfolioDrawdownPct:6,maxPositionLossPct:5},
  });
  assert.equal(config.selection.minOverall,55);
  assert.equal(config.selection.topN,10);
  assert.equal(config.fundamental.minValue,65);
  assert.equal(config.fundamental.minQuality,70);
  assert.equal(config.technical.minScore,60);
  assert.equal(config.risk.maxPortfolioDrawdownPct,6);
});

test('legacy stores preserve existing feature contracts', () => {
  const config = applyParameterPreset('conservative');
  const stores = legacyStoresFromParameters(config);
  assert.equal(stores.screening.minTechnical,config.technical.minScore);
  assert.equal(stores.fundamental.minQualityScore,config.fundamental.minQuality);
  assert.equal(stores.risk.maxSectorWeightPct,config.risk.maxSectorWeightPct);
});

test('font mapping has no option below 16 pixels', () => {
  assert.equal(fontScalePx('standard'),16);
  assert.equal(fontScalePx('large'),18);
  assert.equal(fontScalePx('xlarge'),20);
  assert.equal(fontScalePx('unknown'),16);
});
