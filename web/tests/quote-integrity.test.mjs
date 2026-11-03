import test from 'node:test';
import assert from 'node:assert/strict';
import { onRequestGet, parseYahooJapan, parseGoogleFinance } from '../functions/api/quotes.js';

const prices = { '7974':8000, '6857':40000, '6920':46000 };
const paper = {
  paper_only:true, seed_cost_basis:30722100, cash:21548300, realized_pnl:234000,
  positions:[
    { symbol:'7974.T', code:'7974', company_name:'任天堂', quantity:100, avg_cost:7588 },
    { symbol:'6857.T', code:'6857', company_name:'アドバンテスト', quantity:100, avg_cost:40400 },
    { symbol:'6920.T', code:'6920', company_name:'レーザーテック', quantity:100, avg_cost:46090 },
  ],
};
const daily = { paper_only:true, generated_at:'2026-10-13T23:59:15+09:00',
  trading_date:'2026-10-13', summary:{equity:31014500,total_pnl:292400,cumulative_return_pct:.9518,unrealized_pnl:58400} };

async function requestWithSources({ independent }) {
  const original = globalThis.fetch;
  globalThis.fetch = async input => {
    const url = String(input);
    const code = url.match(/(?:quote\/|chart\/)(\d{4}|285A)\.T/)?.[1] ??
      url.match(/quote\/(\d{4}|285A):TYO/)?.[1];
    const price = prices[code] ?? 1000;
    if (url.includes('query2.finance.yahoo.com')) return Response.json({
      chart:{result:[{meta:{regularMarketPrice:price,regularMarketTime:Math.floor(Date.now()/1000)}}]},
    });
    if (url.includes('finance.yahoo.co.jp')) return new Response(
      independent ? '<div>' + price.toLocaleString('en-US') + ' 前日比 0 リアルタイム株価 15:30</div>' : 'unavailable',
      {status:independent?200:503});
    if (url.includes('google.com/finance')) return new Response(
      independent ? '<div data-last-price="' + price + '"></div>' : 'unavailable',
      {status:independent?200:503});
    throw new Error('unexpected network request ' + url);
  };
  try {
    const context = {
      request:new Request('https://valuescope-japan.pages.dev/api/quotes?compact=1&force=1'),
      env:{ ASSETS:{ fetch:async req => Response.json(req.url.includes('portfolio.json')?paper:daily) } },
    };
    const response = await onRequestGet(context);
    assert.equal(response.status,200);
    return response.json();
  } finally { globalThis.fetch = original; }
}
test('single-source quotes keep paper P/L unvalued instead of inventing returns', async()=>{
  const result=await requestWithSources({independent:false});
  assert.equal(result.positions.length,3);
  assert.equal(result.portfolio.basis,'paper-ledger');
  assert.equal(result.portfolio.valuation_complete,false);
  assert.equal(result.portfolio.total_current_value,null);
  assert.equal(result.portfolio.total_pnl,null);
  assert.equal(result.portfolio.confirmed.total_pnl,292400);
  assert.ok(result.positions.every(x=>x.usable===false));
});
test('independently matched fresh quotes mark only the three active holdings', async()=>{
  const result=await requestWithSources({independent:true});
  assert.equal(result.positions.length,3);
  assert.equal(result.portfolio.position_count,3);
  assert.equal(result.portfolio.valuation_complete,true);
  assert.equal(result.portfolio.total_current_value,30948300);
  assert.equal(result.portfolio.total_pnl,226200);
  assert.equal(result.portfolio.total_unrealized_pnl,-7800);
  assert.equal(result.portfolio.realized_pnl,234000);
});

test('November 2026 Yahoo JP and Google Finance markup parses the same dated close',()=>{
  const yahoo=parseYahooJapan('<div>8,149 前日比-140(-1.69%) リアルタイム株価 11/2</div>');
  const google=parseGoogleFinance('<div data-last-price="1140.36"></div><span jsname="Pdsbrc" class=""><span>¥8,149.00</span></span><div class="jZZ2de">11月2日, 15:30:00 UTC+9</div>');
  assert.equal(yahoo.price,8149);
  assert.equal(google.price,8149);
  assert.match(yahoo.quote_time,/2026-11-02/);
  assert.match(google.quote_time,/2026-11-02/);
});
