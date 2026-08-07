import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_RISK_POLICY, normalizeRiskPolicy } from '../risk-diagnostics-core.js';

test('risk diagnostics module loads with stable default limits', () => {
  const policy = normalizeRiskPolicy({});
  assert.equal(policy.maxPortfolioDrawdownPct, DEFAULT_RISK_POLICY.maxPortfolioDrawdownPct);
  assert.equal(policy.maxTotalUnrealizedLossPct, DEFAULT_RISK_POLICY.maxTotalUnrealizedLossPct);
  assert.equal(policy.maxPositionLossPct, DEFAULT_RISK_POLICY.maxPositionLossPct);
});
