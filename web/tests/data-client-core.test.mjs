import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildSavedQuotePayload,
  deriveCompactQuotePayload,
  isForcedQuoteRefresh,
  normalizeDataUrl,
  portfolioStatusText,
  requestKind,
} from '../data-client-core.js';

test('normalizes transient cache-busting parameters while preserving compact mode', () => {
  const normalized = normalizeDataUrl('/api/quotes?ts=123&compact=1&refresh=456', 'https://example.test/');
  assert.equal(normalized, 'https://example.test/api/quotes?compact=1');
  assert.equal(requestKind(normalized), 'quotes');
  assert.equal(isForcedQuoteRefresh('/api/quotes?refresh=1', 'https://example.test/'), true);
});

test('builds an immediate saved quote fallback from daily report and demo entries', () => {
  const report = {
    generated_at:'2026-08-07T07:15:00+09:00',
    decisions:[{
      code:'1000',
      symbol:'1000.T',
      company_name:'例社',
      technical:{price:110},
      quote:{valid:true,quote_time:'2026-08-07T15:30:00+09:00',verification:'double-checked'},
    }],
  };
  const demo = { positions:[{code:'1000',symbol:'1000.T',company_name:'例社',quantity:100,entry_price:100}] };
  const full = buildSavedQuotePayload(report, demo, false);
  assert.equal(full.portfolio.total_current_value, 11000);
  assert.equal(full.portfolio.total_unrealized_pnl, 1000);
  assert.equal(full.quotes[0].primary_source, '日次保存スナップショット');
  const compact = deriveCompactQuotePayload(full);
  assert.equal(compact.positions[0].current_price, 110);
  assert.match(portfolioStatusText(compact), /total\t10000\t11000\t1000/);
});
