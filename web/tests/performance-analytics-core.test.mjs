import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPerformanceAnalytics, computeDrawdown, computeTradeStatistics, normalizeEquityHistory } from '../performance-analytics-core.js';

const demo = {
  total_entry_value: 100000,
  opened_at: '2026-01-01T09:00:00+09:00',
  positions: [{symbol:'A.T',entry_price:100,quantity:100,entry_time:'2026-01-01T09:00:00+09:00'}],
};

test('normalizes duplicates and prepends the opening capital', () => {
  const result = normalizeEquityHistory({history:[{date:'2026-01-03',equity:101000},{date:'2026-01-03',equity:102000}]},100000,demo.opened_at);
  assert.equal(result.duplicates,1);
  assert.deepEqual(result.rows.map(row=>row.equity),[100000,102000]);
});

test('known drawdown exposes peak trough recovery and duration', () => {
  const rows = [
    {date:'2026-01-01',equity:100},
    {date:'2026-01-02',equity:120},
    {date:'2026-01-03',equity:90},
    {date:'2026-01-04',equity:100},
    {date:'2026-01-05',equity:125},
  ];
  const result = computeDrawdown(rows);
  assert.equal(result.maximum_pct.value,-25);
  assert.equal(result.peak_date,'2026-01-02');
  assert.equal(result.trough_date,'2026-01-03');
  assert.equal(result.recovery_date,'2026-01-05');
  assert.equal(result.maximum_duration_days.value,2);
});

test('short history gates annualized and tail metrics', () => {
  const result = buildPerformanceAnalytics({
    equityHistory:{history:[{date:'2026-01-02',equity:101000},{date:'2026-01-03',equity:102000}]},
    trades:{trades:[]},portfolio:{cash:0,positions:[]},latestReport:{decisions:[]},demoPortfolio:demo,
  });
  assert.equal(result.risk_adjusted.sharpe_ratio.status,'insufficient_history');
  assert.equal(result.risk_adjusted.sortino_ratio.status,'insufficient_history');
  assert.equal(result.risk.var_95_pct.status,'insufficient_history');
  assert.equal(result.overview.cagr_pct.status,'insufficient_history');
  assert.ok(Math.abs(result.overview.total_return_pct.value-2)<1e-9);
});

test('trade quality calculates payoff risk reward profit factor and expectancy', () => {
  const demoPayload={positions:[
    {symbol:'A.T',entry_price:100,quantity:100,entry_time:'2026-01-01'},
    {symbol:'B.T',entry_price:100,quantity:100,entry_time:'2026-01-01'},
  ]};
  const stats=computeTradeStatistics({trades:[
    {side:'SIM_SELL',symbol:'A.T',price:120,quantity:100,date:'2026-01-10'},
    {side:'SIM_SELL',symbol:'B.T',price:90,quantity:100,date:'2026-01-10'},
  ]},demoPayload);
  assert.equal(stats.win_rate_pct.value,50);
  assert.equal(stats.payoff_ratio.value,2);
  assert.equal(stats.risk_reward_ratio.value,2);
  assert.equal(stats.profit_factor.value,2);
  assert.equal(stats.expectancy_per_trade.value,500);
});

test('position concentration and benchmark metrics remain null-safe', () => {
  const history=[];
  const start = new Date('2026-03-01T00:00:00Z');
  for(let index=0;index<50;index+=1){
    const date = new Date(start.getTime()+index*86400000).toISOString().slice(0,10);
    history.push({date,equity:100000+index*100});
  }
  const result=buildPerformanceAnalytics({
    equityHistory:{history},trades:{trades:[]},
    portfolio:{cash:10000,positions:[{symbol:'A.T',code:'A',quantity:100,avg_cost:100},{symbol:'B.T',code:'B',quantity:50,avg_cost:100}]},
    latestReport:{decisions:[{symbol:'A.T',technical:{price:110},quote:{valid:true}},{symbol:'B.T',technical:{price:90},quote:{valid:true}}]},
    demoPortfolio:{...demo,total_entry_value:100000},benchmark:null,
  });
  assert.equal(result.positions.position_count,2);
  assert.ok(result.positions.largest_position_pct>0);
  assert.equal(result.benchmark.status,'benchmark_unavailable');
  assert.doesNotThrow(()=>JSON.stringify(result));
});
