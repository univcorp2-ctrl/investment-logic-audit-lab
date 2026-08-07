import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');

test('quote API uses bounded concurrency and short upstream timeout', async () => {
  const source = await readFile(resolve(root, 'functions/api/quotes.js'), 'utf8');
  assert.match(source, /mapWithConcurrency\(SECURITIES, CONCURRENCY, buildQuote\)/);
  assert.match(source, /const CONCURRENCY = [2-9]/);
  const timeout = Number(source.match(/const SOURCE_TIMEOUT_MS = (\d+)/)?.[1]);
  assert.ok(timeout > 0 && timeout <= 3000);
  assert.doesNotMatch(source, /pause\(120\)/);
  assert.doesNotMatch(source, /for\s*\(const item of initial\)/);
  assert.match(source, /maxDifference > 3/);
});

test('data client is injected before consumers', async () => {
  const build = await readFile(resolve(root, 'scripts/build.mjs'), 'utf8');
  const dataClient = build.indexOf('<script type="module" src="./data-client.js"></script>');
  const demo = build.indexOf('<script type="module" src="./demo-trade.js"></script>');
  assert.ok(dataClient >= 0 && demo > dataClient);
});
