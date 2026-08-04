import test from 'node:test';
import assert from 'node:assert/strict';
import { METRIC_DEFINITIONS, finite } from '../performance-analytics-core.js';

test('performance analytics module loads and preserves missing values', () => {
  assert.equal(finite(null), null);
  assert.equal(finite('12.5'), 12.5);
  assert.match(METRIC_DEFINITIONS.sharpe_ratio, /年率超過収益/);
});
