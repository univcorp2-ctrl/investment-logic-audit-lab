import { cp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const dist = resolve(root, 'dist');
await rm(dist, { recursive: true, force: true });
await mkdir(dist, { recursive: true });

for (const file of [
  'index.html',
  'styles.css',
  'app.js',
  'dashboard.js',
  'scoring.js',
  'demo-data.js',
  'summary-fix.js',
]) {
  await cp(resolve(root, file), resolve(dist, file));
}
for (const file of [
  'jquants-ranking.json',
  'jquants-ranking.csv',
  'live-ranking.json',
  'live-ranking.csv',
]) {
  try {
    await stat(resolve(root, file));
    await cp(resolve(root, file), resolve(dist, file));
  } catch {
    // A first build can happen before a data refresh has generated the file.
  }
}

const indexPath = resolve(dist, 'index.html');
const index = await readFile(indexPath, 'utf-8');
const marker = '<script type="module" src="./summary-fix.js"></script>';
if (!index.includes(marker)) {
  await writeFile(indexPath, index.replace('</body>', `  ${marker}\n  </body>`), 'utf-8');
}
console.log('Built ValueScope Japan into web/dist');
