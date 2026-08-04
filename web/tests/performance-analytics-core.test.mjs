import test from 'node:test';
import assert from 'node:assert/strict';
import { PERFORMANCE_GLOSSARY, finiteNumber } from '../performance-analytics-core.js';

test('performance analytics module loads and preserves missing values', () => {
  assert.equal(finiteNumber(null), null);
  assert.equal(finiteNumber('12.5'), 12.5);
  assert.equal(PERFORMANCE_GLOSSARY.sharpe_ratio.label, 'シャープレシオ');
});
