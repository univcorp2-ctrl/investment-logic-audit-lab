import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';

async function openApp(page, viewport) {
  await page.setViewportSize(viewport);
  await page.goto('/', { waitUntil:'domcontentloaded' });
  await expect(page.locator('#parameterControl')).toBeVisible({ timeout:20_000 });
}

async function openConditions(page, mobile = false) {
  const selector = mobile
    ? '#adaptiveMobileNav [data-adaptive-target="screening"]'
    : '#adaptiveLargeNav [data-adaptive-target="screening"]';
  await page.locator(selector).click();
  await expect(page.locator('#parameterControl')).toBeVisible();
  await page.locator('#parameterControl').scrollIntoViewIfNeeded();
}

async function noHorizontalOverflow(page) {
  return page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 2);
}

test('PC: quality preset, fundamental edits, save and reload persistence', async ({ page }) => {
  await openApp(page, { width:1440, height:900 });
  await expect(page.locator('#adaptiveModeIndicator')).toContainText('PC / iPad表示');
  await openConditions(page, false);
  await page.locator('[data-parameter-preset="quality"]').click();
  await page.locator('[data-parameter-tab="fundamental"]').click();
  await page.locator('#pc-fundamental-minRoePct').fill('8');
  await page.locator('#pc-fundamental-weights-quality').fill('55');
  await page.locator('#pcSave').click();
  await expect(page.locator('#pcDirty')).toHaveText('保存済み');
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('valuescope-parameter-bundle-v1')));
  expect(stored.fundamental.minRoePct).toBe(8);
  expect(stored.fundamental.weights.quality).toBe(55);
  await page.reload({ waitUntil:'domcontentloaded' });
  await expect(page.locator('#parameterControl')).toBeVisible({ timeout:20_000 });
  await openConditions(page, false);
  await page.locator('[data-parameter-tab="fundamental"]').click();
  await expect(page.locator('#pc-fundamental-minRoePct')).toHaveValue('8');
  await expect(page.locator('#pc-fundamental-weights-quality')).toHaveValue('55');
  await expect(page.locator('#ftRoe')).toHaveValue('8');
});

for (const viewport of [{ width:1024, height:768 }, { width:768, height:1024 }]) {
  test(`iPad ${viewport.width}x${viewport.height}: readable controls and no overflow`, async ({ page }) => {
    await openApp(page, viewport);
    await expect(page.locator('#adaptiveModeIndicator')).toContainText('PC / iPad表示');
    await openConditions(page, false);
    expect(await noHorizontalOverflow(page)).toBe(true);
    const saveBox = await page.locator('#pcSave').boundingBox();
    expect(saveBox?.height ?? 0).toBeGreaterThanOrEqual(40);
    const labelSize = await page.locator('#parameterControl .pc-field > span').first().evaluate(node => parseFloat(getComputedStyle(node).fontSize));
    expect(labelSize).toBeGreaterThanOrEqual(12);
  });
}

for (const viewport of [{ width:390, height:844 }, { width:375, height:812 }]) {
  test(`iPhone ${viewport.width}x${viewport.height}: bottom navigation, readable fonts and no overflow`, async ({ page }) => {
    await openApp(page, viewport);
    await expect(page.locator('#adaptiveModeIndicator')).toContainText('iPhone表示');
    await openConditions(page, true);
    expect(await noHorizontalOverflow(page)).toBe(true);
    const bodySize = await page.evaluate(() => parseFloat(getComputedStyle(document.body).fontSize));
    const labelSize = await page.locator('#parameterControl .pc-field > span').first().evaluate(node => parseFloat(getComputedStyle(node).fontSize));
    const saveBox = await page.locator('#pcSave').boundingBox();
    expect(bodySize).toBeGreaterThanOrEqual(15);
    expect(labelSize).toBeGreaterThanOrEqual(12);
    expect(saveBox?.height ?? 0).toBeGreaterThanOrEqual(44);
    await expect(page.locator('#adaptiveMobileNav [data-adaptive-target="screening"]')).toHaveClass(/active/);
  });
}

test('font scale xlarge applies immediately and persists without overflow', async ({ page }) => {
  await openApp(page, { width:390, height:844 });
  await openConditions(page, true);
  const before = await page.evaluate(() => parseFloat(getComputedStyle(document.body).fontSize));
  await page.locator('[data-parameter-tab="display"]').click();
  await page.locator('#pcFontScale').selectOption('xlarge');
  await expect(page.locator('html')).toHaveAttribute('data-font-scale','xlarge');
  const after = await page.evaluate(() => parseFloat(getComputedStyle(document.body).fontSize));
  expect(after).toBeGreaterThan(before);
  await page.locator('#pcSave').click();
  await page.reload({ waitUntil:'domcontentloaded' });
  await expect(page.locator('#parameterControl')).toBeVisible({ timeout:20_000 });
  await expect(page.locator('html')).toHaveAttribute('data-font-scale','xlarge');
  expect(await noHorizontalOverflow(page)).toBe(true);
});

test('settings export, reset, valid import and invalid import error', async ({ page }, testInfo) => {
  await openApp(page, { width:1440, height:900 });
  await openConditions(page, false);
  await page.locator('[data-parameter-tab="management"]').click();
  const downloadPromise = page.waitForEvent('download');
  await page.locator('#pcExport').click();
  const download = await downloadPromise;
  const downloadPath = testInfo.outputPath('valuescope-parameters.json');
  await download.saveAs(downloadPath);
  const exported = JSON.parse(await readFile(downloadPath,'utf8'));
  expect(exported.schemaVersion).toBe(1);
  await page.locator('#pcReset').click();
  const fixture = {
    schemaVersion:1,
    preset:'custom',
    screening:{minQuality:66},
    fundamental:{minRoePct:9,weights:{quality:52}},
    risk:{maxPortfolioDrawdownPct:6},
    display:{fontScale:'large',density:'comfortable',contrast:'normal',reducedMotion:false},
  };
  await page.locator('#pcImport').setInputFiles({ name:'valid-parameters.json', mimeType:'application/json', buffer:Buffer.from(JSON.stringify(fixture)) });
  await page.locator('[data-parameter-tab="fundamental"]').click();
  await expect(page.locator('#pc-fundamental-minRoePct')).toHaveValue('9');
  await page.locator('[data-parameter-tab="management"]').click();
  await page.locator('#pcImport').setInputFiles({ name:'invalid-parameters.json', mimeType:'application/json', buffer:Buffer.from(JSON.stringify({schemaVersion:999,screening:{minQuality:999}})) });
  await expect(page.locator('#pcImportError')).toBeVisible();
  await expect(page.locator('#pcImportError')).toContainText('schemaVersion');
});

test('daily KPI and parameter UI render before delayed live quotes', async ({ page }) => {
  await page.route('**/api/quotes**', async route => {
    await new Promise(resolve => setTimeout(resolve,5000));
    await route.fulfill({ status:200, contentType:'application/json', body:JSON.stringify({generated_at:new Date().toISOString(),portfolio:{total_current_value:100,total_unrealized_pnl:0},positions:[]}) });
  });
  const started = Date.now();
  await openApp(page, { width:390, height:844 });
  await expect(page.locator('#adaptiveOverviewTitle')).toBeVisible({ timeout:3000 });
  await expect(page.locator('#parameterControl')).toBeAttached({ timeout:3000 });
  expect(Date.now()-started).toBeLessThan(5000);
});
