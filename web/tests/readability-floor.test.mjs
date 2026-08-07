import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');

test('supporting text floor is 13px and mobile body floor is 14px', async () => {
  const css = await readFile(resolve(root, 'readability.css'), 'utf8');
  assert.match(css, /--vs-small-size:13px/);
  assert.match(css, /--vs-label-size:13px/);
  assert.match(css, /font-size:13px!important/);
  assert.match(css, /font-size:max\(\.875rem,14px\)!important/);
  assert.doesNotMatch(css, /--vs-small-size:12px/);
  assert.doesNotMatch(css, /button b\{font-size:12px!important/);
});

test('font modes remain 16 18 and 20 pixels', async () => {
  const css = await readFile(resolve(root, 'readability.css'), 'utf8');
  assert.match(css, /data-font-scale=normal\]\{font-size:16px/);
  assert.match(css, /data-font-scale=large\]\{font-size:18px/);
  assert.match(css, /data-font-scale=xlarge\]\{font-size:20px/);
});
