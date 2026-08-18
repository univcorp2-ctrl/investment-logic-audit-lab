import { expect, test } from '@playwright/test';

const portfolio={cash:27069700,seed_cost_basis:30722100,positions:[{symbol:'6857.T',code:'6857',company_name:'アドバンテスト',quantity:100,avg_cost:31260},{symbol:'7974.T',code:'7974',company_name:'任天堂',quantity:100,avg_cost:7588}]};
const history={history:[
  {date:'2026-08-03',equity:30809600,total_pnl:87500,unrealized_pnl:87500,cumulative_return_pct:.2848},
  {date:'2026-08-04',equity:31587500,total_pnl:865400,unrealized_pnl:-120000,cumulative_return_pct:2.8169},
  {date:'2026-08-07',equity:31152000,total_pnl:429900,unrealized_pnl:-300000,cumulative_return_pct:1.3993},
  {date:'2026-08-13',equity:31496200,total_pnl:774100,unrealized_pnl:541700,cumulative_return_pct:2.5197},
]};
const metrics={risk_adjusted:{sharpe_ratio:{value:null,status:'insufficient_history'},sortino_ratio:{value:null,status:'insufficient_history'},calmar_ratio:{value:null,status:'insufficient_history'}},risk:{annualized_volatility_pct:{value:null},downside_deviation_pct:{value:null},historical_var_95_pct:{value:null},historical_cvar_95_pct:{value:null},ulcer_index:{value:null},pain_index_pct:{value:null}},performance:{cagr_pct:{value:null}},benchmark:{},trading_quality:{turnover_today:{value:0}}};
const report={summary:{equity:31496200,total_pnl:774100,cumulative_return_pct:2.5197},decisions:[]};
const quotes={generated_at:'2026-08-18T02:20:00Z',positions:[{symbol:'6857.T',code:'6857',name:'アドバンテスト',current_price:36500,quote_time:'2026-08-18T11:20:00+09:00',verification:'double-checked',usable:true,max_difference_pct:.3},{symbol:'7974.T',code:'7974',name:'任天堂',current_price:8900,quote_time:'2026-08-18T11:20:00+09:00',verification:'double-checked',usable:true,max_difference_pct:.2}]};

async function mock(page){
  await page.route('**/data/paper-trading/portfolio.json**',route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(portfolio)}));
  await page.route('**/data/paper-trading/equity-history.json**',route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(history)}));
  await page.route('**/data/paper-trading/performance-metrics.json**',route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(metrics)}));
  await page.route('**/data/paper-trading/latest-report.json**',route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(report)}));
  await page.route('**/api/quotes**',route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(quotes)}));
}
async function open(page,viewport){await page.setViewportSize(viewport);await mock(page);await page.goto('/',{waitUntil:'domcontentloaded'});await expect(page.locator('#performanceCockpit')).toBeVisible({timeout:20000});}
async function noOverflow(page){const size=await page.evaluate(()=>({scroll:document.documentElement.scrollWidth,inner:window.innerWidth}));expect(size.scroll).toBeLessThanOrEqual(size.inner+2);}

for(const viewport of[{width:390,height:844},{width:375,height:812}]){
  test(`iPhone ${viewport.width} shows focus metrics and readable controls`,async({page})=>{
    await open(page,viewport);
    const hero=page.locator('#pcockMobileHero');
    await expect(hero).toBeVisible();
    await expect(hero.getByText('累積利益率',{exact:true})).toBeVisible();
    await expect(hero.getByText('最大DD / 最大含み損',{exact:true})).toBeVisible();
    await expect(hero).toContainText('300,000');
    await expect(hero.locator('.pcock-focus-card')).toHaveCount(2);
    for(const id of['#pcockShrink','#pcockResetGraph','#pcockGrow']){
      const box=await page.locator(id).boundingBox();expect(box?.height??0).toBeGreaterThanOrEqual(44);
    }
    const strip=page.locator('#pcockMetrics');
    const widths=await strip.evaluate(node=>({scroll:node.scrollWidth,client:node.clientWidth}));
    expect(widths.scroll).toBeGreaterThan(widths.client);
    await noOverflow(page);
  });
}

test('graph grow shrink reset and full-date point readout work',async({page})=>{
  await open(page,{width:390,height:844});
  const chart=page.locator('#pcockChart');
  const normal=(await chart.boundingBox()).height;
  await page.locator('#pcockGrow').click();
  await expect(page.locator('#performanceCockpit')).toHaveAttribute('data-graph-size','large');
  const large=(await chart.boundingBox()).height;expect(large).toBeGreaterThan(normal);
  await page.locator('#pcockShrink').click();
  await page.locator('#pcockShrink').click();
  await expect(page.locator('#performanceCockpit')).toHaveAttribute('data-graph-size','compact');
  const compact=(await chart.boundingBox()).height;expect(compact).toBeLessThan(large);
  await page.locator('#pcockResetGraph').click();
  await expect(page.locator('#performanceCockpit')).toHaveAttribute('data-graph-size','normal');
  const reset=(await chart.boundingBox()).height;expect(reset).toBeGreaterThan(compact);expect(reset).toBeLessThan(large);
  await expect(page.locator('#pcockRange')).toContainText('開始 2026/08/03');
  const firstDate=page.locator('#pcockDateStrip button').first();
  await expect(firstDate).toHaveAttribute('aria-label',/2026\/08\/03/);
  await firstDate.click();
  await expect(page.locator('#pcockPointReadout')).toContainText('2026/08/03');
});

for(const viewport of[{width:1440,height:900},{width:1024,height:768}]){
  test(`wide ${viewport.width} keeps cockpit graph usable`,async({page})=>{
    await open(page,viewport);
    await expect(page.locator('#pcockGraphTools')).toBeVisible();
    await expect(page.locator('#pcockChart svg')).toBeVisible();
    await noOverflow(page);
  });
}
