import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');

test('font boot supports official normal large and xlarge preferences', async () => {
  const source = await readFile(resolve(root, 'font-boot.js'), 'utf8');
  assert.match(source, /valuescope-font-scale-v1/);
  assert.match(source, /valuescope-display-preferences-v1/);
  assert.match(source, /valuescope-parameter-bundle-v1/);
  for (const value of ['normal', 'large', 'xlarge']) assert.match(source, new RegExp(value));
  assert.match(source, /dataset\.fontScale/);
});
