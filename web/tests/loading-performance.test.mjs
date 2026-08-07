import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');

test('fetch coordinator is loaded before quote-consuming modules', async () => {
  const build = await readFile(resolve(root, 'scripts/build.mjs'), 'utf8');
  const coordinator = build.indexOf('<script type="module" src="./fetch-coordinator.js"></script>');
  const demo = build.indexOf('<script type="module" src="./demo-trade.js"></script>');
  assert.ok(coordinator >= 0);
  assert.ok(demo > coordinator);
  assert.match(build, /fast-data-bootstrap\.js/);
  assert.match(build, /adaptive-shell\.js/);
  assert.doesNotMatch(build, /<script[^>]*src="\.\/data-client\.js"/);
  assert.doesNotMatch(build, /<script[^>]*src="\.\/app-shell\.js"/);
});

test('coordinator contains immediate saved fallback and one background live request', async () => {
  const source = await readFile(resolve(root, 'fetch-coordinator.js'), 'utf8');
  assert.match(source, /savedQuotePromise/);
  assert.match(source, /buildSavedQuotePayload/);
  assert.match(source, /quoteInflight/);
  assert.match(source, /_saved_snapshot/);
  assert.match(source, /valuescope:quotes/);
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
