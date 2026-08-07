import { expect, test } from '@playwright/test';

const viewports = [
  { name: 'PC', width: 1440, height: 900, mode: 'PC' },
  { name: 'iPad landscape', width: 1024, height: 768, mode: 'iPad' },
  { name: 'iPad portrait', width: 768, height: 1024, mode: 'iPad' },
  { name: 'iPhone', width: 390, height: 844, mode: 'iPhone' },
];

async function openConditions(page, viewport) {
  await page.setViewportSize({ width: viewport.width, height: viewport.height });
  await page.goto('/#view=screening', { waitUntil: 'domcontentloaded' });
  const mobile = page.locator('#adaptiveMobileNav [data-adaptive-target="screening"]');
  const large = page.locator('#adaptiveLargeNav [data-adaptive-target="screening"]');
  if (await mobile.isVisible()) await mobile.click();
  else if (await large.isVisible()) await large.click();
  await expect(page.locator('#parameterControl')).toBeVisible({ timeout: 25_000 });
}

for (const viewport of viewports) {
  test(`production ${viewport.name}: parameter controls and readable typography`, async ({ page }, testInfo) => {
    const consoleErrors = [];
    page.on('console', message => {
      if (message.type() === 'error') consoleErrors.push(message.text());
    });
    await openConditions(page, viewport);
    await expect(page.getByRole('heading', { name: 'パラメータコントロール' })).toBeVisible();
    await expect(page.locator('#adaptiveModeIndicator')).toContainText(viewport.mode);
    await expect(page.locator('#parameterControl [role="tab"]')).toHaveCount(6);

    await page.locator('[data-parameter-tab="fundamental"]').click();
    await expect(page.locator('#pc-fundamental-minRoePct')).toBeVisible();
    await expect(page.locator('#pc-fundamental-minFcfYieldPct')).toBeVisible();
    await page.locator('[data-parameter-tab="risk"]').click();
    await expect(page.locator('#pc-risk-maxPortfolioDrawdownPct')).toBeVisible();
    await page.locator('[data-parameter-tab="display"]').click();
    await expect(page.locator('#pcFontScale')).toBeVisible();

    const typography = await page.locator('#parameterControl').evaluate(root => {
      const visible = [...root.querySelectorAll('button,label,summary,p,small,span,b,input,select')]
        .filter(node => {
          const rect = node.getBoundingClientRect();
          const style = getComputedStyle(node);
          return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden' && (node.textContent?.trim() || ['INPUT','SELECT'].includes(node.tagName));
        });
      return {
        minimumFont: Math.min(...visible.map(node => Number.parseFloat(getComputedStyle(node).fontSize))),
        minimumControlHeight: Math.min(...visible.filter(node => ['BUTTON','INPUT','SELECT','SUMMARY'].includes(node.tagName)).map(node => node.getBoundingClientRect().height)),
      };
    });
    expect(typography.minimumFont).toBeGreaterThanOrEqual(12);
    if (viewport.width <= 767) expect(typography.minimumControlHeight).toBeGreaterThanOrEqual(44);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(2);
    expect(consoleErrors.filter(message => !/quote|network|fetch|favicon/i.test(message))).toEqual([]);
    await testInfo.attach(`production-${viewport.name}`, {
      body: await page.screenshot({ fullPage: true }),
      contentType: 'image/png',
    });
  });
}
