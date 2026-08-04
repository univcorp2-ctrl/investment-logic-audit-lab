import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CHART_MODES,
  DEFAULT_ANALYSIS_SETTINGS,
  METRIC_DEFINITIONS,
  finite,
  recalculateAnalysis,
} from '../performance-analytics-core.js';

test('performance analytics module loads and preserves missing values', () => {
  assert.equal(finite(null), null);
  assert.equal(finite('12.5'), 12.5);
  assert.equal(CHART_MODES.drawdown.label, 'ドローダウン');
  assert.match(METRIC_DEFINITIONS.sharpe_ratio, /超過収益/);
  const result = recalculateAnalysis([{ date:'2026-08-03', equity:100 }], DEFAULT_ANALYSIS_SETTINGS);
  assert.equal(result.risk_adjusted.sharpe_ratio.value, null);
});
