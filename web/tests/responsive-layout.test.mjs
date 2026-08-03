import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');

test('responsive layer includes iPhone breakpoint and safe areas', async () => {
  const css = await readFile(resolve(root, 'responsive-enhancements.css'), 'utf8');
  assert.match(css, /max-width:767px/);
  assert.match(css, /safe-area-inset-bottom/);
  assert.match(css, /min-height:44px/);
  assert.match(css, /mobile-navigation/);
});

test('responsive script installs viewport indicator and five mobile destinations', async () => {
  const source = await readFile(resolve(root, 'responsive-mode.js'), 'utf8');
  assert.match(source, /viewportMode/);
  for (const label of ['概要','判断','条件','損益','プラン']) assert.match(source, new RegExp(label));
  assert.match(source, /matchMedia/);
  assert.match(source, /orientationchange/);
});
