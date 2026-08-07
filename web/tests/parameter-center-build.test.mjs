import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const root=resolve(import.meta.dirname,'..');

test('official parameter control and readability assets are in production build',async()=>{
  const build=await readFile(resolve(root,'scripts/build.mjs'),'utf8');
  assert.match(build,/parameter-control-core\.js/);
  assert.match(build,/parameter-control\.js/);
  assert.match(build,/parameter-control\.css/);
  assert.match(build,/font-boot\.js/);
  assert.match(build,/readability\.css/);
  assert.doesNotMatch(build,/<script type="module" src="\.\/parameter-center\.js"><\/script>/);
  const readability=build.lastIndexOf('readability.css');
  const adaptive=build.lastIndexOf('adaptive-shell.css');
  assert.ok(readability>adaptive);
});

test('readability CSS guarantees 16 18 and 20 pixel modes including iPhone',async()=>{
  const css=await readFile(resolve(root,'readability.css'),'utf8');
  assert.match(css,/data-font-scale=normal/);
  assert.match(css,/data-font-scale=large/);
  assert.match(css,/data-font-scale=xlarge/);
  assert.match(css,/font-size:16px/);
  assert.match(css,/font-size:18px/);
  assert.match(css,/font-size:20px/);
  assert.doesNotMatch(css,/data-font-scale=(small|tiny)/);
  assert.match(css,/min-height:44px!important/);
  assert.match(css,/font-size:16px!important/);
});

test('Playwright suite covers PC, two iPads and two iPhones',async()=>{
  const source=await readFile(resolve(root,'e2e/parameter-control.spec.mjs'),'utf8');
  for(const marker of ['1440','1024','768','390','375','slow live API','accessibility smoke']) assert.match(source,new RegExp(marker));
});
