import test from 'node:test';
import assert from 'node:assert/strict';
import { combinedRiskHero, extractChartPointLabels, graphSizePx, historicalMaxUnrealizedLoss, nextGraphSize, nextZoomPeriod } from '../performance-cockpit-mobile-core.js';

test('historical max unrealized loss uses the worst negative observation',()=>{
  const rows=[
    {date:'2026-08-03',equity:30800000,unrealized_pnl:87500},
    {date:'2026-08-04',equity:31500000,unrealized_pnl:-120000},
    {date:'2026-08-07',equity:31100000,unrealized_pnl:-300000},
    {date:'2026-08-08',equity:31200000,unrealized_pnl:-50000},
  ];
  const worst=historicalMaxUnrealizedLoss(rows,30000000);
  assert.equal(worst.amount,-300000);
  assert.equal(worst.pct,-1);
  assert.equal(worst.date,'2026-08-07');
});

test('combined risk hero uses worse live drawdown and keeps historical unrealized loss',()=>{
  const rows=[
    {date:'2026-08-03',equity:30000000,unrealized_pnl:-100000},
    {date:'2026-08-04',equity:33000000,unrealized_pnl:50000},
    {date:'2026-08-07',equity:32000000,unrealized_pnl:-300000},
  ];
  const risk=combinedRiskHero(rows,30000000,31000000);
  assert.equal(risk.max_unrealized_loss.amount,-300000);
  assert.ok(risk.current_drawdown_pct < -6);
  assert.equal(risk.worse_drawdown_pct,risk.current_drawdown_pct);
  assert.equal(risk.includes_live,true);
});

test('graph size and zoom controls step and clamp',()=>{
  assert.equal(nextGraphSize('normal',1),'large');
  assert.equal(nextGraphSize('large',1),'large');
  assert.equal(nextGraphSize('normal',-1),'compact');
  assert.equal(nextZoomPeriod('all',1),'1y');
  assert.equal(nextZoomPeriod('1m',1),'1w');
  assert.equal(nextZoomPeriod('1w',1),'1w');
  assert.ok(graphSizePx('large',true)>graphSizePx('normal',true));
  assert.ok(graphSizePx('normal',true)>graphSizePx('compact',true));
});

test('chart point labels expose full and short dates',()=>{
  const labels=extractChartPointLabels(['2026-08-03 3080.0万','bad','2026-08-07 -1.4%']);
  assert.equal(labels.length,2);
  assert.equal(labels[0].shortDate,'08/03');
  assert.equal(labels[0].fullText,'2026/08/03 · 3080.0万');
  assert.equal(labels[1].date,'2026-08-07');
});
