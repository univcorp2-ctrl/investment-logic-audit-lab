import { expect, test } from '@playwright/test';

const payload = {
  code:'8035', name:'東京エレクトロン', data_dates:{effective_fundamental_cutoff:'2026-05-11',latest_price_date:'2026-08-07'},
  fundamental:{score:75,value_score:80,quality_score:78,data_completeness:90},
  technical:{score:68,price:50000,rsi14:60,momentum20_pct:4,momentum60_pct:8,volatility20_pct:30,drawdown20_pct:-3},
  recommendation:{summary:'SIM_HOLD',confidence:80,fundamental_reasons_positive:['割安性'],fundamental_risks:['Freeデータは遅延'],technical_reasons_positive:['SMA上昇'],technical_risks:['短期変動'],evidence_dates:{fundamental:'2026-05-11',technical:'2026-08-07'}},
  financials:{status:'ok',periods:[],details_status:'not_entitled',latest_details:null}, earnings:{status:'ok',history:[],next:null},
  disclosures:{status:'tdnet_addon_not_configured',items:[],search_url:'https://www.release.tdnet.info/inbs/I_main_00.html'},
  general_news:[{title:'東京エレクトロンの一般ニュース',source:'Example Media',published_at:'2026-08-07T00:00:00Z',link:'https://example.com/news'}],
  chart:{status:'ok',rows:Array.from({length:80},(_,i)=>({date:new Date(Date.UTC(2026,3,1+i)).toISOString().slice(0,10),open:100+i,high:103+i,low:98+i,close:101+i,volume:1000+i}))}, warnings:[], paper_only:true,
};

test('security news keeps official disclosures separate from general news', async ({ page }) => {
  await page.setViewportSize({width:1440,height:900});
  await page.route('**/api/security-detail**', route => route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(payload)}));
  await page.route('**/api/quotes**', route => route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({portfolio:{},positions:[]})}));
  await page.goto('/', {waitUntil:'domcontentloaded'});
  await page.evaluate(() => window.ValueScopeSecurityDetail.open('8035'));
  await expect(page.locator('#securityDetailDialog')).toBeVisible();
  await page.getByRole('tab',{name:'ニュース・開示'}).click();
  await expect(page.getByText('適時開示データは未接続')).toBeVisible();
  await expect(page.getByText('架空ニュースは表示しません')).toBeVisible();
  await expect(page.getByText('一般ニュース（公式開示ではありません）')).toBeVisible();
  await expect(page.getByText('東京エレクトロンの一般ニュース')).toBeVisible();
  await expect(page.getByText('Example Media')).toBeVisible();
});
