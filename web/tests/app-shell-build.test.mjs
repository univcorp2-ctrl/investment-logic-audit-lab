import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');

test('production build loads the authoritative app shell last', async () => {
  const build = await readFile(resolve(root, 'scripts/build.mjs'), 'utf8');
  assert.match(build, /app-shell\.css/);
  assert.match(build, /app-shell-polish\.css/);
  assert.match(build, /app-shell\.js/);
  assert.doesNotMatch(build, /<script type="module" src="\.\/responsive-mode\.js"><\/script>/);
  assert.doesNotMatch(build, /<link rel="stylesheet" href="\.\/responsive-enhancements\.css" \/>/);
});

test('app shell avoids nested main and keeps five primary destinations', async () => {
  const source = await readFile(resolve(root, 'app-shell.js'), 'utf8');
  assert.doesNotMatch(source, /<main id="uxViewHost"/);
  for (const label of ['概要', '投資判断', '条件設定', '損益・リスク', 'データ・プラン']) {
    assert.match(source, new RegExp(label));
  }
});

test('polish layer has separate iPhone iPad and desktop layouts', async () => {
  const css = await readFile(resolve(root, 'app-shell-polish.css'), 'utf8');
  assert.match(css, /max-width:767px/);
  assert.match(css, /min-width:768px/);
  assert.match(css, /max-width:1180px/);
  assert.match(css, /min-width:1181px/);
  assert.match(css, /safe-area-inset-bottom/);
  assert.match(css, /--ux-touch:44px/);
});

test('phone tables are converted to cards with labels', async () => {
  const source = await readFile(resolve(root, 'app-shell.js'), 'utf8');
  const css = await readFile(resolve(root, 'app-shell-polish.css'), 'utf8');
  assert.match(source, /labelResponsiveTables/);
  assert.match(source, /demoTradeBody/);
  assert.match(source, /rankingBody/);
  assert.match(css, /\.demo-table tbody/);
  assert.match(css, /\.ranking tbody tr/);
});
