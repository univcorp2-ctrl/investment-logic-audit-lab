import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');

test('quote API uses bounded concurrency, source timeout and stable edge cache', async () => {
  const source = await readFile(resolve(root, 'functions/api/quotes.js'), 'utf8');
  assert.match(source, /CONCURRENCY = 4/);
  assert.match(source, /SOURCE_TIMEOUT_MS = 2800/);
  assert.match(source, /mapWithConcurrency/);
  assert.doesNotMatch(source, /pause\(120\)/);
  assert.doesNotMatch(source, /for\s*\(const item of initial\)/);
  assert.match(source, /stale-while-revalidate=120/);
  assert.match(source, /source_status/);
  assert.match(source, /partial:/);
});

test('data client module is injected before consumers', async () => {
  const build = await readFile(resolve(root, 'scripts/build.mjs'), 'utf8');
  const dataClient = build.indexOf('<script type="module" src="./data-client.js"></script>');
  const demo = build.indexOf('<script type="module" src="./demo-trade.js"></script>');
  assert.ok(dataClient >= 0 && demo > dataClient);
});
