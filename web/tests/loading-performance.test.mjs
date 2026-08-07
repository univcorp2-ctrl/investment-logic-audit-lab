import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');

test('shared data client is loaded before live-data startup modules', async () => {
  const build = await readFile(resolve(root, 'scripts/build.mjs'), 'utf8');
  const client = build.indexOf('<script type="module" src="./data-client.js"></script>');
  const demo = build.indexOf('<script type="module" src="./demo-trade.js"></script>');
  assert.ok(client >= 0);
  assert.ok(demo > client);
});

test('data client includes in-flight deduplication timeout fallback and background refresh', async () => {
  const source = await readFile(resolve(root, 'data-client.js'), 'utf8');
  assert.match(source, /inFlight/);
  assert.match(source, /NETWORK_TIMEOUT_MS/);
  assert.match(source, /saved-fallback/);
  assert.match(source, /requestIdleCallback/);
  assert.match(source, /valuescope:quotes/);
  assert.match(source, /portfolioStatusResponse/);
});

test('quote function has bounded concurrency stable cache and partial response', async () => {
  const source = await readFile(resolve(root, 'functions/api/quotes.js'), 'utf8');
  assert.match(source, /CONCURRENCY = 4/);
  assert.match(source, /SOURCE_TIMEOUT_MS/);
  assert.match(source, /mapWithConcurrency/);
  assert.match(source, /stale-while-revalidate=120/);
  assert.match(source, /partial:/);
  assert.match(source, /cacheUrl\.searchParams\.set\('mode'/);
});
