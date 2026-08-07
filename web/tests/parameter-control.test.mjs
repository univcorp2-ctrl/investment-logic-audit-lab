import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_PARAMETER_BUNDLE,
  PARAMETER_SCHEMA_VERSION,
  PARAMETER_STORAGE_KEYS,
  applyParameterPreset,
  bundleFromStorage,
  impactPreview,
  parameterChanges,
  storagePayloads,
  validateParameterBundle,
} from '../parameter-control-core.js';

function memoryStorage(values = {}) {
  const map = new Map(Object.entries(values));
  return {
    getItem: key => map.has(key) ? map.get(key) : null,
    setItem: (key, value) => map.set(key, String(value)),
  };
}

test('quality preset raises quality and ROE thresholds', () => {
  const result = applyParameterPreset('quality', DEFAULT_PARAMETER_BUNDLE);
  assert.equal(result.preset, 'quality');
  assert.equal(result.screening.minQuality, 70);
  assert.equal(result.fundamental.minQualityScore, 70);
  assert.equal(result.fundamental.minRoePct, 5);
  assert.equal(result.fundamental.weights.quality, 45);
});

test('loss-control preset tightens risk limits without enabling orders', () => {
  const result = applyParameterPreset('lossControl', DEFAULT_PARAMETER_BUNDLE);
  assert.equal(result.risk.maxPortfolioDrawdownPct, 5);
  assert.equal(result.risk.maxPositionWeightPct, 15);
  assert.equal(Object.hasOwn(result, 'brokerOrder'), false);
});

test('invalid import is rejected with accessible validation detail', () => {
  const result = validateParameterBundle({ schemaVersion: PARAMETER_SCHEMA_VERSION, screening:{minQuality:999} });
  assert.equal(result.valid, false);
  assert.match(result.errors.join(' '), /minQuality/);
});

test('wrong schema is rejected', () => {
  const result = validateParameterBundle({ ...structuredClone(DEFAULT_PARAMETER_BUNDLE), schemaVersion: 999 });
  assert.equal(result.valid, false);
  assert.match(result.errors.join(' '), /schemaVersion/);
});

test('existing individual storage keys remain authoritative', () => {
  const storage = memoryStorage({
    [PARAMETER_STORAGE_KEYS.bundle]: JSON.stringify(DEFAULT_PARAMETER_BUNDLE),
    [PARAMETER_STORAGE_KEYS.screening]: JSON.stringify({ minQuality: 77 }),
    [PARAMETER_STORAGE_KEYS.fundamental]: JSON.stringify({ minRoePct: 12 }),
    [PARAMETER_STORAGE_KEYS.fontScale]: 'large',
  });
  const result = bundleFromStorage(storage);
  assert.equal(result.screening.minQuality, 77);
  assert.equal(result.fundamental.minRoePct, 12);
  assert.equal(result.display.fontScale, 'large');
});

test('storage payload writes legacy and central keys', () => {
  const payload = storagePayloads(DEFAULT_PARAMETER_BUNDLE);
  assert.ok(payload[PARAMETER_STORAGE_KEYS.bundle]);
  assert.ok(payload[PARAMETER_STORAGE_KEYS.screening]);
  assert.ok(payload[PARAMETER_STORAGE_KEYS.fundamental]);
  assert.ok(payload[PARAMETER_STORAGE_KEYS.risk]);
});

test('change summary includes fundamental weight edits', () => {
  const next = structuredClone(DEFAULT_PARAMETER_BUNDLE);
  next.fundamental.weights.quality = 55;
  const changes = parameterChanges(DEFAULT_PARAMETER_BUNDLE, next);
  assert.ok(changes.some(change => change.key === 'fundamental.weights.quality'));
});

test('impact preview returns honest counts from sanitized data', () => {
  const ranking = { rows:[{code:'1000',company_name:'A',overall_score:80,value_score:80,quality_score:80,growth_stability_score:70,technical_score:70,liquidity_score:80,value_trap_risk:20,data_completeness:80}] };
  const report = { summary:{equity:10000,unrealized_pnl:0}, decisions:[{code:'1000',company_name:'A',holding:{quantity:100,avg_cost:100},fundamental:{score:80,value_score:80,quality_score:80,growth_stability_score:70,value_trap_risk:20,data_completeness:80},technical:{score:70,price:100,rsi14:55,momentum20_pct:3,momentum60_pct:8,volatility20_pct:30,drawdown20_pct:-2},quote:{valid:true},decision:{action:'SIM_HOLD'}}] };
  const metrics = { sample:{seed_cost_basis:10000,current_equity:10000},series:{equity:[{date:'2026-08-01',equity:10000}]} };
  const demo = { total_entry_value:10000,positions:[{code:'1000',quantity:100,entry_price:100}] };
  const preview = impactPreview(DEFAULT_PARAMETER_BUNDLE, ranking, report, metrics, demo);
  assert.equal(preview.available, true);
  assert.equal(preview.universeCount, 1);
  assert.equal(preview.screeningIncluded, 1);
});
