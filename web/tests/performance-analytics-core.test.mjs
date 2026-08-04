import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildPerformanceAnalytics,
  computeDrawdown,
  computeTradeStatistics,
  normalizeEquityHistory,
} from '../performance-analytics-core.js';

const demo = {
  total_entry_value: 100000,
  opened_at: '2026-01-01T09:00:00+09:00',
  positions: [{ symbol:'A.T', entry_price:100, quantity:100, entry_time:'2026-01-01' }],
};

test('normalizes duplicate dates and preserves the final observation', () => {
  const result = normalizeEquityHistory({ history:[
    { date:'2026-01-02', equity:101000 },
    { date:'2026-01-02', equity:102000 },
  ] }, 100000, demo.opened_at);
  assert.equal(result.duplicates, 1);
  assert.equal(result.rows.at(-1).equity, 102000);
});

test('drawdown finds the known peak, trough and recovery', () => {
  const result = computeDrawdown([
    { date:'2026-01-01', equity:100 },
    { date:'2026-01-02', equity:120 },
    { date:'2026-01-03', equity:90 },
    { date:'2026-01-04', equity:125 },
  ]);
  assert.equal(result.maximum_pct.value, -25);
  assert.equal(result.peak_date, '2026-01-02');
  assert.equal(result.trough_date, '2026-01-03');
  assert.equal(result.recovery_date, '2026-01-04');
});

test('trade statistics calculate realized quality ratios', () => {
  const stats = computeTradeStatistics({ trades:[
    { side:'SIM_SELL', symbol:'A.T', price:120, quantity:100, date:'2026-01-10' },
    { side:'SIM_SELL', symbol:'B.T', price:90, quantity:100, date:'2026-01-10' },
  ] }, { positions:[
    { symbol:'A.T', entry_price:100, quantity:100, entry_time:'2026-01-01' },
    { symbol:'B.T', entry_price:100, quantity:100, entry_time:'2026-01-01' },
  ] });
  assert.equal(stats.win_rate_pct.value, 50);
  assert.equal(stats.payoff_ratio.value, 2);
  assert.equal(stats.profit_factor.value, 2);
  assert.equal(stats.expectancy_per_trade.value, 500);
});

test('two-day analytics expose total return but gate unstable ratios', () => {
  const result = buildPerformanceAnalytics({
    equityHistory:{ history:[{ date:'2026-01-02', equity:101000 }] },
    trades:{ trades:[] },
    portfolio:{ cash:0, positions:[] },
    latestReport:{ decisions:[] },
    demoPortfolio:demo,
  });
  assert.equal(result.risk_adjusted.sharpe_ratio.status, 'insufficient_history');
  assert.equal(result.risk.var_95_pct.status, 'insufficient_history');
  assert.ok(result.overview.total_return_pct.value > 0);
  assert.doesNotThrow(() => JSON.stringify(result));
});
