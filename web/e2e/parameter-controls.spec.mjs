import { test, expect } from '@playwright/test';

const quotePayload = {
  generated_at: '2026-08-08T06:00:00Z',
  portfolio: {
    total_entry_value: 30722100,
    total_current_value: 31000000,
    total_unrealized_pnl: 277900,
    total_return_pct: 0.9045,
    winners: 6,
    losers: 4,
    unchanged: 0,
    usable_quotes: 10,
    double_checked: 10,
  },
  positions: [
    { symbol:'8035.T', code:'8035', name:'東京エレクトロン', entry_price:54720, current_price:55000, unrealized_pnl:28000, return_pct:0.5117, usable:true, verification:'double-checked', quote_time:'2026-08-08T15:00:00+09:00' },
  ],
};

async function installApiMocks(page) {
  await page.route('**/api/quotes**', route => route.fulfill({ status:200, contentType:'application/json', body:JSON.stringify(quotePayload) }));
  await page.route('**/api/portfolio-status**', route => route.fulfill({
    status:200,
    contentType:'text/plain; charset=utf-8',
    body:'generated_at\t2026-08-08T06:00:00Z\ntotal\t30722100\t31000000\t277900\t0.9045\t6\t4\t0\t10\t10\n',
  }));
}

async function openParameterCenter(page) {
  await page.goto('/#view=screening', { waitUntil:'domcontentloaded' });
  const nav = page.locator('#uxPrimaryNav button[data-view="screening"]');
  if (await nav.count()) await nav.click();
  await expect(page.locator('#parameterControlCenter')).toBeVisible();
}

test.beforeEach(async ({ page }) => {
  await installApiMocks(page);
});

test('parameter changes apply to existing controls and persist', async ({ page }, testInfo) => {
  await openParameterCenter(page);
  await page.locator('#pcMinQualityNumber').fill('72');
  await page.getByRole('tab', { name:'損失上限' }).click();
  await page.locator('#pcMaxDdNumber').fill('6.5');
  await page.locator('#pccApply').click();
  await expect(page.locator('#pccStatus')).toHaveText('画面へ適用済み');

  const saved = await page.evaluate(() => ({
    screening: JSON.parse(localStorage.getItem('valuescope-screening-lab-v1') || '{}'),
    risk: JSON.parse(localStorage.getItem('valuescope-risk-policy-v1') || '{}'),
  }));
  expect(saved.screening.minQuality).toBe(72);
  expect(saved.risk.maxPortfolioDrawdownPct).toBe(6.5);

  await page.reload({ waitUntil:'domcontentloaded' });
  const nav = page.locator('#uxPrimaryNav button[data-view="screening"]');
  if (await nav.count()) await nav.click();
  await expect(page.locator('#parameterControlCenter')).toBeVisible();
  await expect(page.locator('#pcMinQualityNumber')).toHaveValue('72');
  await page.getByRole('tab', { name:'損失上限' }).click();
  await expect(page.locator('#pcMaxDdNumber')).toHaveValue('6.5');
  await testInfo.attach('parameter-control-center', { body:await page.screenshot({ fullPage:true }), contentType:'image/png' });
});

test('font size control is readable and survives reload', async ({ page }) => {
  await openParameterCenter(page);
  await page.getByRole('tab', { name:'表示' }).click();
  await page.locator('#pcFontScalexlarge').check();
  await page.locator('#pccApply').click();
  await expect.poll(() => page.evaluate(() => getComputedStyle(document.documentElement).fontSize)).toBe('20px');
  await page.reload({ waitUntil:'domcontentloaded' });
  await expect.poll(() => page.evaluate(() => getComputedStyle(document.documentElement).fontSize)).toBe('20px');

  const offenders = await page.locator('#parameterControlCenter').evaluate(root => {
    return [...root.querySelectorAll('button,label,summary,p,small,span,b,input,select')]
      .filter(node => {
        const style = getComputedStyle(node);
        const rect = node.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none' && node.textContent.trim();
      })
      .map(node => ({ tag:node.tagName, text:node.textContent.trim().slice(0,40), size:Number.parseFloat(getComputedStyle(node).fontSize) }))
      .filter(item => item.size < 13);
  });
  expect(offenders).toEqual([]);
});

test('responsive mode is automatic and page has no horizontal overflow', async ({ page }, testInfo) => {
  await openParameterCenter(page);
  const expected = testInfo.project.name.startsWith('iphone') ? 'iPhone表示' : testInfo.project.name.startsWith('ipad') ? 'iPad表示' : 'PC表示';
  await expect(page.locator('#uxModeLabel')).toHaveText(expected);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(1);
  const minimumTarget = await page.locator('#parameterControlCenter button:visible').evaluateAll(nodes => Math.min(...nodes.map(node => node.getBoundingClientRect().height)));
  expect(minimumTarget).toBeGreaterThanOrEqual(44);
});
