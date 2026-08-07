import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const root=resolve(import.meta.dirname,'..');

test('parameter center and readability assets are in production build',async()=>{
  const build=await readFile(resolve(root,'scripts/build.mjs'),'utf8');
  assert.match(build,/parameter-center-core\.js/);
  assert.match(build,/parameter-center\.js/);
  assert.match(build,/parameter-center\.css/);
  assert.match(build,/readability\.css/);
  const readability=build.lastIndexOf('readability.css');
  const adaptive=build.lastIndexOf('adaptive-shell.css');
  assert.ok(readability>adaptive);
});

test('readability CSS has no sub-standard font scale and enforces mobile controls',async()=>{
  const css=await readFile(resolve(root,'readability.css'),'utf8');
  assert.match(css,/data-font-scale=standard/);
  assert.match(css,/data-font-scale=large/);
  assert.match(css,/data-font-scale=xlarge/);
  assert.doesNotMatch(css,/data-font-scale=(small|tiny)/);
  assert.match(css,/font-size:16px!important/);
  assert.match(css,/min-height:44px!important/);
});

test('Playwright suite covers PC, two iPads and two iPhones',async()=>{
  const source=await readFile(resolve(root,'e2e/parameter-center.spec.mjs'),'utf8');
  for(const marker of ['1440','1024','768','390','375','slow live API','accessibility smoke']) assert.match(source,new RegExp(marker));
});
