import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeDataUrl,
  normalizeRequestKey,
  portfolioStatusText,
  staleAgeSeconds,
  summaryFromStatic,
} from '../data-client-core.js';

test('quote and portfolio requests share one canonical compact key', () => {
  const quote = normalizeRequestKey('/api/quotes?compact=1&ts=1');
  const portfolio = normalizeRequestKey('/api/portfolio-status?offset=0&limit=10');
  assert.equal(quote, portfolio);
});

test('static JSON cache busting is removed while stable parameters remain', () => {
  assert.equal(
    normalizeDataUrl('/data/paper-trading/latest-report.json?ts=123'),
    'https://valuescope.local/data/paper-trading/latest-report.json',
  );
});

test('portfolio status is derived from a compact quote payload', () => {
  const text = portfolioStatusText({
    generated_at: '2026-08-07T00:00:00Z',
    portfolio: {
      total_entry_value: 100,
      total_current_value: 110,
      total_unrealized_pnl: 10,
      total_return_pct: 10,
      winners: 1,
      losers: 0,
      unchanged: 0,
      usable_quotes: 1,
      double_checked: 0,
    },
    positions: [{
      code: '1000',
      name: 'A',
      entry_price: 100,
      current_price: 110,
      unrealized_pnl: 10,
      return_pct: 10,
      verification: 'saved-daily-snapshot',
      usable: true,
    }],
  });
  assert.match(text, /total\t100\t110\t10\t10/);
  assert.match(text, /1000\tA/);
});

test('stale age and static summary remain explicit', () => {
  assert.equal(staleAgeSeconds('2026-08-07T00:00:00Z', Date.parse('2026-08-07T00:01:40Z')), 100);
  const summary = summaryFromStatic(
    {
      summary: { total_pnl: 100, cumulative_return_pct: 1, unrealized_pnl: -10 },
      fundamental_source: { plan: 'free', effective_data_cutoff: '2026-05-11' },
    },
    { risk: { current_drawdown_pct: { value: -2 } } },
  );
  assert.equal(summary.totalPnl, 100);
  assert.equal(summary.currentDrawdownPct, -2);
  assert.equal(summary.effectiveCutoff, '2026-05-11');
});
