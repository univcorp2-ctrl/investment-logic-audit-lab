import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const root=resolve(import.meta.dirname,'..');

test('fetch coordinator is loaded before quote-consuming modules',async()=>{const build=await readFile(resolve(root,'scripts/build.mjs'),'utf8');const coordinator=build.indexOf('fetch-coordinator.js');const demo=build.indexOf('demo-trade.js');assert.ok(coordinator>=0);assert.ok(demo>coordinator);assert.match(build,/fast-data-bootstrap\.js/)});

test('coordinator provides one shared compact quote request and timeout',async()=>{const source=await readFile(resolve(root,'fetch-coordinator.js'),'utf8');assert.match(source,/quoteInflight/);assert.match(source,/\/api\/quotes\?compact=1/);assert.match(source,/12000/);assert.match(source,/valuescope:quotes/)});

test('fast bootstrap displays static daily data before live quotes',async()=>{const source=await readFile(resolve(root,'fast-data-bootstrap.js'),'utf8');assert.match(source,/日次データ表示済み・現在値を更新中/);assert.match(source,/latest-report\.json/);assert.match(source,/performance-metrics\.json/)});
