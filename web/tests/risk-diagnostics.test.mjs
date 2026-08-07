import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_RISK_POLICY, currentRiskSnapshot, evaluateRiskPolicy, mobileDateRange, normalizeRiskPolicy } from '../risk-diagnostics-core.js';

test('normalizes invalid negative limits back to defaults', () => {
  const policy = normalizeRiskPolicy({ maxPositionLossPct: -1, maxPortfolioDrawdownPct: -5 });
  assert.equal(policy.maxPositionLossPct, DEFAULT_RISK_POLICY.maxPositionLossPct);
  assert.equal(policy.maxPortfolioDrawdownPct, DEFAULT_RISK_POLICY.maxPortfolioDrawdownPct);
});

test('current snapshot calculates drawdown from recorded peak', () => {
  const snapshot = currentRiskSnapshot(
    { sample:{seed_cost_basis:10000}, series:{equity:[{date:'2026-08-03',equity:11000}]} },
    { portfolio:{total_current_value:9000,total_unrealized_pnl:-1000}, positions:[] },
    { positions:[] },
    {},
  );
  assert.equal(snapshot.entryBasis, 10000);
  assert.equal(snapshot.currentEquity, 9000);
  assert.equal(snapshot.unrealizedPct, -10);
  assert.ok(snapshot.liveDrawdownPct < -18 && snapshot.liveDrawdownPct > -19);
});

test('risk policy marks a drawdown breach', () => {
  const result = evaluateRiskPolicy(
    { entryBasis:10000,currentEquity:9000,unrealized:-1000,unrealizedPct:-10,peakEquity:11000,liveDrawdownPct:-18.18,positions:[] },
    { ...DEFAULT_RISK_POLICY, maxPortfolioDrawdownPct:8, maxTotalUnrealizedLossPct:5 },
  );
  assert.equal(result.status, 'high');
  assert.ok(result.breaches.some(item => item.code === 'portfolio_drawdown'));
  assert.ok(result.breaches.some(item => item.code === 'total_unrealized_pct'));
});

test('mobile date range reports explicit start end and point count', () => {
  const range = mobileDateRange([{date:'2026-08-03T00:00:00Z'},{date:'2026-08-07T00:00:00Z'}], 'all');
  assert.match(range.start, /2026-08-03/);
  assert.match(range.end, /2026-08-07/);
  assert.equal(range.calendarDays, 5);
  assert.equal(range.points, 2);
});
