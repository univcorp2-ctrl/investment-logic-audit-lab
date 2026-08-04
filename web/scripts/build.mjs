import { cp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const dist = resolve(root, 'dist');
await rm(dist, { recursive: true, force: true });
await mkdir(dist, { recursive: true });

const staticFiles = [
  'index.html','styles.css','app.js','dashboard.js','scoring.js','demo-data.js',
  'summary-fix.js','demo-trade.js','demo-trade-core.js','demo-trade.css','demo-portfolio.json',
  'decision-report.js','decision-report-core.js','decision-report.css','jquants-plans.json',
  'responsive-mode.js','responsive-enhancements.css',
  'screening-lab.js','screening-lab-core.js','screening-lab.css',
  'strategy-lab-view.js','strategy-lab-view-core.js','strategy-lab-view.css',
];
for (const file of staticFiles) await cp(resolve(root, file), resolve(dist, file));
for (const file of ['jquants-ranking.json','jquants-ranking.csv','live-ranking.json','live-ranking.csv']) {
  try { await stat(resolve(root, file)); await cp(resolve(root, file), resolve(dist, file)); } catch { /* optional generated file */ }
}
try { await stat(resolve(root, 'data')); await cp(resolve(root, 'data'), resolve(dist, 'data'), { recursive: true }); } catch { /* first build */ }

const indexPath = resolve(dist, 'index.html');
let index = await readFile(indexPath, 'utf-8');
for (const marker of [
  '<link rel="stylesheet" href="./demo-trade.css" />',
  '<link rel="stylesheet" href="./decision-report.css" />',
  '<link rel="stylesheet" href="./screening-lab.css" />',
  '<link rel="stylesheet" href="./strategy-lab-view.css" />',
  '<link rel="stylesheet" href="./responsive-enhancements.css" />',
]) {
  if (!index.includes(marker)) index = index.replace('</head>', `  ${marker}\n  </head>`);
}
for (const marker of [
  '<script type="module" src="./summary-fix.js"></script>',
  '<script type="module" src="./demo-trade.js"></script>',
  '<script type="module" src="./decision-report.js"></script>',
  '<script type="module" src="./strategy-lab-view.js"></script>',
  '<script type="module" src="./screening-lab.js"></script>',
  '<script type="module" src="./responsive-mode.js"></script>',
]) {
  if (!index.includes(marker)) index = index.replace('</body>', `  ${marker}\n  </body>`);
}
await writeFile(indexPath, index, 'utf-8');
console.log('Built ValueScope Japan into web/dist');
