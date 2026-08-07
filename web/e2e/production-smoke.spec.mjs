import { test, expect } from '@playwright/test';

test('production parameter screen and readable typography', async ({ page }, testInfo) => {
  const consoleErrors = [];
  page.on('console', message => { if (message.type() === 'error') consoleErrors.push(message.text()); });
  await page.goto('/#view=screening', { waitUntil:'domcontentloaded' });
  const nav = page.locator('#uxPrimaryNav button[data-view="screening"]');
  if (await nav.count()) await nav.click();
  await expect(page.locator('#parameterControlCenter')).toBeVisible({ timeout:20_000 });
  await expect(page.getByRole('heading', { name:'パラメータコントロール' })).toBeVisible();
  await page.getByRole('tab', { name:'Fundamental' }).click();
  await expect(page.locator('#pcRoeNumber')).toBeVisible();
  await page.getByRole('tab', { name:'表示' }).click();
  await expect(page.locator('#pcFontScalelarge')).toBeChecked();
  const smallest = await page.locator('#parameterControlCenter').evaluate(root => Math.min(...[...root.querySelectorAll('button,label,summary,p,small,span,b,input,select')]
    .filter(node => { const rect=node.getBoundingClientRect(); const style=getComputedStyle(node); return rect.width>0 && rect.height>0 && style.display!=='none' && style.visibility!=='hidden' && node.textContent.trim(); })
    .map(node => Number.parseFloat(getComputedStyle(node).fontSize))));
  expect(smallest).toBeGreaterThanOrEqual(13);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(1);
  expect(consoleErrors.filter(message => !/quote|network|fetch/i.test(message))).toEqual([]);
  await testInfo.attach(`production-${testInfo.project.name}`, { body:await page.screenshot({ fullPage:true }), contentType:'image/png' });
});
