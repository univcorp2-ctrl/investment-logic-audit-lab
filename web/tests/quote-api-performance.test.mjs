import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');

test('quote API uses bounded parallel fast path', async () => {
  const source = await readFile(resolve(root, 'functions/api/quotes.js'), 'utf8');
  assert.match(source, /Promise\.allSettled\(SECURITIES\.map\(fetchChart\)\)/);
  assert.match(source, /UPSTREAM_TIMEOUT_MS = 2500/);
  assert.doesNotMatch(source, /pause\(120\)/);
  assert.doesNotMatch(source, /for\s*\(const item of initial\)/);
  assert.match(source, /Server-Timing/);
});

test('data client is injected before consumers', async () => {
  const build = await readFile(resolve(root, 'scripts/build.mjs'), 'utf8');
  const dataClient = build.indexOf('<script src="./data-client.js"></script>');
  const demo = build.indexOf('<script type="module" src="./demo-trade.js"></script>');
  assert.ok(dataClient >= 0 && demo > dataClient);
});
