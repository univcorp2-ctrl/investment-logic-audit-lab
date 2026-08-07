import test from 'node:test';
import assert from 'node:assert/strict';
import { canonicalUrl, isStaticJson, normalizeQuotePayload, portfolioStatusText } from '../fetch-coordinator-core.js';

test('canonical URL removes cache busters and unifies quote mode', () => {
  const url = canonicalUrl('/api/quotes?refresh=123&compact=0', 'https://example.com/');
  assert.equal(url.pathname, '/api/quotes');
  assert.equal(url.search, '?compact=1');
  const json = canonicalUrl('/data/report.json?ts=123', 'https://example.com/');
  assert.equal(json.search, '');
});

test('compact quote payload is normalized for all consumers', () => {
  const payload = normalizeQuotePayload({ positions:[{symbol:'1000.T',code:'1000',name:'例',current_price:101,usable:true}] });
  assert.equal(payload.positions.length, 1);
  assert.equal(payload.quotes.length, 1);
  assert.equal(payload.quotes[0].symbol, '1000.T');
});

test('portfolio status can be synthesized from shared quote payload', () => {
  const text = portfolioStatusText({ generated_at:'2026-08-07T00:00:00Z', portfolio:{total_entry_value:100,total_current_value:110,total_unrealized_pnl:10,total_return_pct:10}, positions:[{code:'1000',name:'例',entry_price:100,current_price:110,unrealized_pnl:10,return_pct:10,usable:true}] },0,10);
  assert.match(text,/total\t100\t110\t10\t10/);
  assert.match(text,/1000\t例/);
});

test('static JSON detection is same-origin only', () => {
  assert.equal(isStaticJson(new URL('https://example.com/a.json'),'https://example.com'),true);
  assert.equal(isStaticJson(new URL('https://other.test/a.json'),'https://example.com'),false);
});
