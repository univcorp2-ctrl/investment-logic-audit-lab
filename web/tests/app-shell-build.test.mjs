import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');

test('production build loads the adaptive shell last', async () => {
  const build = await readFile(resolve(root, 'scripts/build.mjs'), 'utf8');
  assert.match(build, /adaptive-shell\.css/);
  assert.match(build, /adaptive-shell\.js/);
  assert.doesNotMatch(build, /<script type="module" src="\.\/responsive-mode\.js"><\/script>/);
  assert.doesNotMatch(build, /<link rel="stylesheet" href="\.\/responsive-enhancements\.css" \/>/);
  const shell = build.indexOf('<script type="module" src="./adaptive-shell.js"></script>');
  const screening = build.indexOf('<script type="module" src="./screening-lab.js"></script>');
  assert.ok(shell > screening);
});

test('adaptive shell keeps separate large and iPhone navigation', async () => {
  const source = await readFile(resolve(root, 'adaptive-shell.js'), 'utf8');
  const css = await readFile(resolve(root, 'adaptive-shell.css'), 'utf8');
  for (const label of ['概要', '投資判断', '条件設定', '損益・リスク', 'データ・プラン']) assert.match(source, new RegExp(label));
  for (const label of ['概要', '判断', '条件', '損益', 'その他']) assert.match(source, new RegExp(label));
  assert.match(source, /max-width: 767px/);
  assert.match(css, /min-width:768px/);
  assert.match(css, /max-width:767px/);
  assert.match(css, /safe-area-inset-bottom/);
  assert.match(css, /min-height:44px/);
});

test('phone tables are converted to labelled cards with details', async () => {
  const source = await readFile(resolve(root, 'adaptive-shell.js'), 'utf8');
  const css = await readFile(resolve(root, 'adaptive-shell.css'), 'utf8');
  assert.match(source, /labelTable/);
  assert.match(source, /詳細を見る/);
  assert.match(css, /adaptive-row-more/);
  assert.match(css, /data-label/);
});
