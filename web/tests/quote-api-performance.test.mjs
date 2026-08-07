import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');

test('quote API has bounded concurrency timeouts partial fallback and cache', async () => {
  const source = await readFile(resolve(root, 'functions/api/quotes.js'), 'utf8');
  assert.match(source, /SOURCE_TIMEOUT_MS/);
  assert.match(source, /CONCURRENCY/);
  assert.match(source, /mapWithConcurrency/);
  assert.match(source, /Promise\.allSettled/);
  assert.match(source, /partial:/);
  assert.match(source, /stale-while-revalidate/);
  assert.doesNotMatch(source, /pause\(120\)/);
});

test('data client module is injected before consumers', async () => {
  const build = await readFile(resolve(root, 'scripts/build.mjs'), 'utf8');
  const dataClient = build.indexOf('<script type="module" src="./data-client.js"></script>');
  const demo = build.indexOf('<script type="module" src="./demo-trade.js"></script>');
  assert.ok(dataClient >= 0 && demo > dataClient);
});
