import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');

test('shared data client is inserted before quote-consuming scripts', async () => {
  const build = await readFile(resolve(root, 'scripts/build.mjs'), 'utf8');
  const clientMarker = '<script type="module" src="./data-client.js"></script>';
  const demoMarker = '<script type="module" src="./demo-trade.js"></script>';
  const performanceMarker = '<script type="module" src="./performance-dashboard.js"></script>';
  const riskMarker = '<script type="module" src="./risk-diagnostics.js"></script>';
  const client = build.indexOf(clientMarker);
  assert.ok(client >= 0);
  assert.ok(build.indexOf(demoMarker) > client);
  assert.ok(build.indexOf(performanceMarker) > client);
  assert.ok(build.indexOf(riskMarker) > client);
});

test('data client provides one shared quote request timeout and saved fallback', async () => {
  const source = await readFile(resolve(root, 'data-client.js'), 'utf8');
  assert.match(source, /liveQuotePromise/);
  assert.match(source, /NETWORK_TIMEOUT_MS/);
  assert.match(source, /\/api\/quotes/);
  assert.match(source, /saved-fallback/);
  assert.match(source, /requestIdleCallback/);
  assert.match(source, /valuescope:quotes/);
});

test('static fallback is available before live quote completion', async () => {
  const source = await readFile(resolve(root, 'data-client.js'), 'utf8');
  const fallback = source.indexOf('buildSavedQuotePayload');
  const background = source.indexOf('backgroundLiveRefresh');
  assert.ok(fallback >= 0);
  assert.ok(background > fallback);
  assert.match(source, /latest-report\.json/);
  assert.match(source, /demo-portfolio\.json/);
});
