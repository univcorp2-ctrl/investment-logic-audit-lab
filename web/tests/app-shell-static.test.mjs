import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
const root = resolve(import.meta.dirname, '..');

test('CSS contains dedicated desktop tablet and phone modes', async () => {
  const css = await readFile(resolve(root,'app-shell.css'),'utf8');
  assert.match(css,/min-width:1181px/);
  assert.match(css,/min-width:768px.*max-width:1180px/s);
  assert.match(css,/max-width:767px/);
  assert.match(css,/safe-area-inset-bottom/);
  assert.match(css,/min-height:44px/);
  assert.match(css,/--ux-body-size:15px/);
});

test('shell source exposes all five primary views', async () => {
  const source = await readFile(resolve(root,'app-shell.js'),'utf8');
  for (const label of ['概要','投資判断','条件スクリーナー','損益・リスク','データ・プラン']) assert.match(source,new RegExp(label));
  assert.match(source,/aria-current/);
  assert.match(source,/表示密度/);
});
