import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');

test('shared data client is inserted before quote consumers', async () => {
  const build = await readFile(resolve(root, 'scripts/build.mjs'), 'utf8');
  const client = build.indexOf('<script type="module" src="./data-client.js"></script>');
  assert.ok(client >= 0);
  for (const marker of [
    '<script type="module" src="./demo-trade.js"></script>',
    '<script type="module" src="./performance-dashboard.js"></script>',
    '<script type="module" src="./risk-diagnostics.js"></script>',
    '<script type="module" src="./adaptive-shell.js"></script>',
  ]) {
    assert.ok(build.indexOf(marker) > client, `${marker} must load after data-client`);
  }
});

test('data client deduplicates live quotes and returns saved data immediately', async () => {
  const source = await readFile(resolve(root, 'data-client.js'), 'utf8');
  assert.match(source, /liveQuotePromise/);
  assert.match(source, /buildSavedQuotePayload/);
  assert.match(source, /backgroundLiveRefresh/);
  assert.match(source, /valuescope:quotes/);
  assert.match(source, /NETWORK_TIMEOUT_MS/);
});

test('adaptive overview uses the patched shared fetch path', async () => {
  const source = await readFile(resolve(root, 'adaptive-shell.js'), 'utf8');
  assert.match(source, /\/api\/quotes\?compact=1/);
  assert.match(source, /latest-report\.json/);
  assert.match(source, /performance-metrics\.json/);
});
