import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');

test('parameter control labels and no-order warning exist', async () => {
  const source = await readFile(resolve(root, 'parameter-control.js'), 'utf8');
  for (const label of ['スクリーニング','ファンダメンタル','テクニカル','リスク上限','表示','設定管理']) {
    assert.match(source, new RegExp(label));
  }
  assert.match(source, /実注文なし/);
  assert.doesNotMatch(source, /broker.*order/i);
});

test('readability layer enforces font and touch minimums', async () => {
  const css = await readFile(resolve(root, 'readability.css'), 'utf8');
  assert.match(css, /data-font-scale=normal/);
  assert.match(css, /data-font-scale=large/);
  assert.match(css, /data-font-scale=xlarge/);
  assert.match(css, /font-size:16px/);
  assert.match(css, /font-size:15px/);
  assert.match(css, /min-height:44px/);
  assert.match(css, /overflow-x:hidden/);
});

test('font boot reads preferences before feature modules', async () => {
  const source = await readFile(resolve(root, 'font-preferences-boot.js'), 'utf8');
  assert.match(source, /valuescope-display-preferences-v1/);
  assert.match(source, /dataset\.fontScale/);
});
