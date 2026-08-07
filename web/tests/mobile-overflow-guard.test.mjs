import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');

test('mobile overflow guard constrains the page and parameter tabs', async () => {
  const css = await readFile(resolve(root, 'mobile-overflow-guard.css'), 'utf8');
  assert.match(css, /max-width:\s*767px/);
  assert.match(css, /overflow-x:\s*clip/);
  assert.match(css, /\.parameter-control \.pc-tabs/);
  assert.match(css, /margin-inline:\s*0\s*!important/);
  assert.match(css, /max-width:\s*100%/);
});

test('mobile overflow guard is loaded after readability', async () => {
  const build = await readFile(resolve(root, 'scripts/build.mjs'), 'utf8');
  const readability = build.lastIndexOf('readability.css');
  const guard = build.lastIndexOf('mobile-overflow-guard.css');
  assert.ok(readability >= 0 && guard > readability);
});
