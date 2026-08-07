import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const source = file => readFile(resolve(root, file), 'utf8');

test('two-mode boundary assigns 767 to iPhone and 768 to large mode', async () => {
  const js = await source('adaptive-shell.js');
  const css = await source('adaptive-shell.css');
  assert.match(js, /max-width: 767px/);
  assert.match(js, /dataset\.deviceMode/);
  assert.match(css, /@media\(max-width:767px\)/);
  assert.match(css, /@media\(min-width:768px\)/);
  assert.doesNotMatch(css, /@media\(max-width:768px\)/);
});

test('large navigation has six destinations and iPhone navigation has five', async () => {
  const js = await source('adaptive-shell.js');
  for (const label of ['概要','投資判断','条件設定','損益・リスク','戦略検証','データ・プラン']) assert.match(js, new RegExp(label));
  for (const label of ['概要','判断','条件','損益','その他']) assert.match(js, new RegExp(label));
  assert.match(js, /MOBILE_NAV/);
  assert.match(js, /LARGE_NAV/);
});

test('stable section IDs, safe areas and accessible tap targets are present', async () => {
  const js = await source('adaptive-shell.js');
  const css = await source('adaptive-shell.css');
  for (const id of ['overviewSection','decisionSection','screeningSection','performanceSection','strategySection','dataPlanSection']) assert.match(js, new RegExp(id));
  assert.match(css, /safe-area-inset-bottom/);
  assert.match(css, /min-height:44px/);
  assert.match(css, /focus-visible/);
  assert.match(css, /prefers-reduced-motion/);
});

test('advanced content uses disclosures and paper-only status remains visible', async () => {
  const js = await source('adaptive-shell.js');
  assert.match(js, /adaptiveLegacyDetails/);
  assert.match(js, /詳細を見る/);
  assert.match(js, /実注文は送信されません/);
  assert.doesNotMatch(js, /購入する|注文を実行/);
});
