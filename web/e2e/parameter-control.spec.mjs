import { expect, test } from '@playwright/test';

const quotePositions=[
  {symbol:'8035.T',code:'8035',name:'東京エレクトロン',entry_price:54720,current_price:55200,quote_time:'2026-08-07T15:30:00+09:00',unrealized_pnl:48000,return_pct:.877,verification:'double-checked',usable:true,max_difference_pct:.12},
  {symbol:'6857.T',code:'6857',name:'アドバンテスト',entry_price:31260,current_price:31500,quote_time:'2026-08-07T15:30:00+09:00',unrealized_pnl:24000,return_pct:.768,verification:'double-checked',usable:true,max_difference_pct:.08},
];
const quotePayload={generated_at:'2026-08-07T06:30:00Z',timezone:'Asia/Tokyo',portfolio:{total_entry_value:8598000,total_current_value:8670000,total_unrealized_pnl:72000,total_return_pct:.837,winners:2,losers:0,unchanged:0,usable_quotes:2,double_checked:2},positions:quotePositions,quotes:quotePositions};
const portfolioText=`generated_at\t2026-08-07T06:30:00Z\ntotal\t8598000\t8670000\t72000\t0.837\t2\t0\t0\t2\t2\nrange\t0\t2\ncode\tname\tentry\tcurrent\tpnl\treturn_pct\tverification\tusable\tquote_time\tmax_diff_pct\n8035\t東京エレクトロン\t54720\t55200\t48000\t0.877\tdouble-checked\ttrue\t2026-08-07T15:30:00+09:00\t0.12\n6857\tアドバンテスト\t31260\t31500\t24000\t0.768\tdouble-checked\ttrue\t2026-08-07T15:30:00+09:00\t0.08\n`;

async function mockPagesApi(page,delayMs=0){
  await page.route('**/api/quotes**',async route=>{if(delayMs)await new Promise(resolve=>setTimeout(resolve,delayMs));await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(quotePayload)});});
  await page.route('**/api/portfolio-status**',async route=>{if(delayMs)await new Promise(resolve=>setTimeout(resolve,delayMs));await route.fulfill({status:200,contentType:'text/plain; charset=utf-8',body:portfolioText});});
  await page.route('**/api/daily-report-status**',route=>route.fulfill({status:200,contentType:'text/plain',body:'status\tok\n'}));
}

async function openConditions(page){
  const mobile=page.locator('#adaptiveMobileNav [data-adaptive-target="screening"]');
  const large=page.locator('#adaptiveLargeNav [data-adaptive-target="screening"]');
  if(await mobile.isVisible())await mobile.click();else if(await large.isVisible())await large.click();
  await expect(page.locator('#parameterControl')).toBeVisible();
}
async function assertNoOverflow(page){const size=await page.evaluate(()=>({scrollWidth:document.documentElement.scrollWidth,innerWidth:window.innerWidth}));expect(size.scrollWidth).toBeLessThanOrEqual(size.innerWidth+1);}
async function computed(locator,property){return locator.evaluate((element,name)=>parseFloat(getComputedStyle(element)[name]),property);}

 test('PC 1440: preset, large font and persistence',async({page})=>{
  await page.setViewportSize({width:1440,height:900});await mockPagesApi(page);await page.goto('/',{waitUntil:'domcontentloaded'});await openConditions(page);
  await expect(page.locator('#adaptiveModeIndicator')).toContainText('PC');
  await expect(page.locator('#adaptiveLargeNav button')).toHaveCount(6);
  await page.locator('[data-parameter-preset="quality"]').click();
  await expect(page.locator('#pcDirty')).toHaveText('未保存');
  await page.locator('[data-parameter-tab="display"]').click();
  await page.locator('#pcFontScale').selectOption('large');
  await page.locator('#pcSave').click();
  expect(await computed(page.locator('body'),'fontSize')).toBeGreaterThanOrEqual(18);
  await page.reload({waitUntil:'domcontentloaded'});await openConditions(page);await page.locator('[data-parameter-tab="display"]').click();
  await expect(page.locator('#pcFontScale')).toHaveValue('large');
  expect(await computed(page.locator('body'),'fontSize')).toBeGreaterThanOrEqual(18);
 });

for(const viewport of[{name:'landscape',width:1024,height:768},{name:'portrait',width:768,height:1024}]){
 test(`iPad ${viewport.name}: parameter control is usable without overflow`,async({page})=>{
  await page.setViewportSize({width:viewport.width,height:viewport.height});await mockPagesApi(page);await page.goto('/',{waitUntil:'domcontentloaded'});await openConditions(page);
  await expect(page.locator('#adaptiveModeIndicator')).toContainText('iPad');
  await expect(page.locator('#adaptiveLargeNav')).toBeVisible();await expect(page.locator('#parameterControl')).toBeVisible();
  await page.locator('[data-parameter-tab="fundamental"]').click();await expect(page.locator('#pc-fundamental-minRoePct')).toBeVisible();await assertNoOverflow(page);
 });
}

for(const viewport of[{name:'390',width:390,height:844},{name:'375',width:375,height:812}]){
 test(`iPhone ${viewport.name}: readable controls save and reset`,async({page})=>{
  await page.setViewportSize({width:viewport.width,height:viewport.height});await mockPagesApi(page);await page.goto('/',{waitUntil:'domcontentloaded'});
  await expect(page.locator('#adaptiveMobileHeader')).toBeVisible();await expect(page.locator('#adaptiveMobileHeader > span')).toContainText('iPhone');await openConditions(page);
  expect(await computed(page.locator('body'),'fontSize')).toBeGreaterThanOrEqual(16);
  await page.locator('[data-parameter-tab="technical"]').click();
  const rsi=page.locator('#pc-screening-minRsi');await expect(rsi).toBeVisible();expect(await computed(rsi,'fontSize')).toBeGreaterThanOrEqual(16);const box=await rsi.boundingBox();expect(box.height).toBeGreaterThanOrEqual(44);
  await rsi.fill('55');await page.locator('#pcSave').click();await expect(page.locator('#pcDirty')).toHaveText('保存済み');
  await page.reload({waitUntil:'domcontentloaded'});await openConditions(page);await page.locator('[data-parameter-tab="technical"]').click();await expect(page.locator('#pc-screening-minRsi')).toHaveValue('55');
  await page.locator('[data-parameter-tab="management"]').click();await page.locator('#pcReset').click();await page.locator('#pcSave').click();await page.locator('[data-parameter-tab="technical"]').click();await expect(page.locator('#pc-screening-minRsi')).toHaveValue('0');
  await assertNoOverflow(page);
 });
}

test('slow live API does not block saved daily data or parameter UI',async({page})=>{
  await page.setViewportSize({width:390,height:844});await mockPagesApi(page,15000);const started=Date.now();await page.goto('/',{waitUntil:'domcontentloaded'});
  await expect(page.locator('#adaptiveOverviewTitle')).toBeVisible({timeout:5000});await openConditions(page);await expect(page.locator('#parameterControl')).toBeVisible();expect(Date.now()-started).toBeLessThan(8000);await expect(page.locator('#adaptiveOverviewTitle')).not.toContainText('読込中');
});

test('accessibility smoke: roles, unique visible IDs and keyboard focus',async({page})=>{
  await page.setViewportSize({width:1440,height:900});await mockPagesApi(page);await page.goto('/',{waitUntil:'domcontentloaded'});await openConditions(page);
  await expect(page.locator('.pc-tabs')).toHaveAttribute('role','tablist');await expect(page.locator('.pc-tabs [role="tab"]')).toHaveCount(6);
  const duplicates=await page.evaluate(()=>{const visible=element=>Boolean(element.offsetWidth||element.offsetHeight||element.getClientRects().length);const counts=new Map();document.querySelectorAll('[id]').forEach(element=>{if(visible(element))counts.set(element.id,(counts.get(element.id)??0)+1);});return[...counts.entries()].filter(([,count])=>count>1);});expect(duplicates).toEqual([]);
  await page.locator('[data-parameter-tab="display"]').focus();await page.keyboard.press('Enter');await page.locator('#pcFontScale').focus();await expect(page.locator('#pcFontScale')).toBeFocused();await page.locator('#pcSave').focus();await expect(page.locator('#pcSave')).toBeFocused();
});
