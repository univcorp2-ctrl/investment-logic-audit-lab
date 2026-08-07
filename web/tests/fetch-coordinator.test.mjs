import test from 'node:test';
import assert from 'node:assert/strict';
import {
  deriveCompactQuotePayload,
  normalizeRequestKey,
  portfolioStatusText,
  requestKind,
} from '../data-client-core.js';

test('canonical key removes cache busters and unifies quote consumers', () => {
  assert.equal(
    normalizeRequestKey('/api/quotes?refresh=123&compact=0', 'https://example.com/'),
    'https://example.com/api/quotes?compact=1',
  );
  assert.equal(
    normalizeRequestKey('/api/portfolio-status?offset=0&limit=10', 'https://example.com/'),
    'https://example.com/api/quotes?compact=1',
  );
  assert.equal(requestKind('/data/report.json', 'https://example.com/'), 'static-json');
});

test('full quote payload can be normalized for compact consumers', () => {
  const compact = deriveCompactQuotePayload({
    generated_at:'2026-08-07T00:00:00Z',
    portfolio:{total_entry_value:100,total_current_value:110,total_unrealized_pnl:10,total_return_pct:10},
    quotes:[{symbol:'1000.T',code:'1000',name:'例',entry_price:100,current_price:110,unrealized_pnl:10,return_pct:10,usable:true}],
  });
  assert.equal(compact.positions.length, 1);
  assert.equal(compact.positions[0].symbol, '1000.T');
  assert.match(portfolioStatusText(compact, 0, 10), /total\t100\t110\t10\t10/);
});
