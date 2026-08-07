import { cp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const dist = resolve(root, 'dist');
await rm(dist, { recursive:true, force:true });
await mkdir(dist, { recursive:true });
const staticFiles = [
  'index.html','styles.css','app.js','dashboard.js','scoring.js','demo-data.js',
  'data-client.js','data-client-core.js','fetch-coordinator.js','fetch-coordinator-core.js','fast-data-bootstrap.js',
  'summary-fix.js','demo-trade.js','demo-trade-core.js','demo-trade.css','demo-portfolio.json',
  'performance-dashboard.js','performance-dashboard-core.js','performance-dashboard.css',
  'risk-diagnostics.js','risk-diagnostics-core.js','risk-diagnostics.css',
  'decision-report.js','decision-report-core.js','decision-report.css','jquants-plans.json',
  'responsive-mode.js','responsive-enhancements.css',
  'screening-lab.js','screening-lab-core.js','screening-lab.css',
  'fundamental-tuning.js','fundamental-tuning-core.js','fundamental-tuning.css',
  'strategy-lab-view.js','strategy-lab-view-core.js','strategy-lab-view.css',
  'app-shell-core.js','app-shell.js','app-shell.css','app-shell-polish.css',
  'adaptive-shell.js','adaptive-shell.css',
  'parameter-control-core.js','parameter-control.js','parameter-control.css','font-boot.js','readability.css','mobile-overflow-guard.css',
  'mobile-task-flow-core.js','mobile-task-flow.js','mobile-task-flow.css',
  'security-detail-core.js','security-detail.js','security-detail.css',
  'adaptive-learning-core.js','adaptive-learning.js','adaptive-learning.css',
  'parameter-classification.js','parameter-classification.css',
];
for (const file of staticFiles) await cp(resolve(root, file), resolve(dist, file));
for (const file of ['jquants-ranking.json','jquants-ranking.csv','live-ranking.json','live-ranking.csv']) {
  try { await stat(resolve(root, file)); await cp(resolve(root, file), resolve(dist, file)); } catch { /* optional */ }
}
try { await stat(resolve(root, 'data')); await cp(resolve(root, 'data'), resolve(dist, 'data'), { recursive:true }); } catch { /* first build */ }
const indexPath = resolve(dist, 'index.html');
let index = await readFile(indexPath, 'utf-8');
for (const marker of [
  '<link rel="stylesheet" href="./demo-trade.css" />',
  '<link rel="stylesheet" href="./performance-dashboard.css" />',
  '<link rel="stylesheet" href="./risk-diagnostics.css" />',
  '<link rel="stylesheet" href="./decision-report.css" />',
  '<link rel="stylesheet" href="./screening-lab.css" />',
  '<link rel="stylesheet" href="./fundamental-tuning.css" />',
  '<link rel="stylesheet" href="./strategy-lab-view.css" />',
  '<link rel="stylesheet" href="./adaptive-shell.css" />',
  '<link rel="stylesheet" href="./parameter-control.css" />',
  '<link rel="stylesheet" href="./security-detail.css" />',
  '<link rel="stylesheet" href="./adaptive-learning.css" />',
  '<link rel="stylesheet" href="./parameter-classification.css" />',
  '<link rel="stylesheet" href="./readability.css" />',
  '<link rel="stylesheet" href="./mobile-overflow-guard.css" />',
  '<link rel="stylesheet" href="./mobile-task-flow.css" />',
]) {
  if (!index.includes(marker)) index = index.replace('</head>', `  ${marker}\n  </head>`);
}
for (const marker of [
  '<script type="module" src="./font-boot.js"></script>',
  '<script type="module" src="./fetch-coordinator.js"></script>',
  '<script type="module" src="./summary-fix.js"></script>',
  '<script type="module" src="./demo-trade.js"></script>',
  '<script type="module" src="./performance-dashboard.js"></script>',
  '<script type="module" src="./risk-diagnostics.js"></script>',
  '<script type="module" src="./decision-report.js"></script>',
  '<script type="module" src="./strategy-lab-view.js"></script>',
  '<script type="module" src="./screening-lab.js"></script>',
  '<script type="module" src="./fundamental-tuning.js"></script>',
  '<script type="module" src="./adaptive-shell.js"></script>',
  '<script type="module" src="./fast-data-bootstrap.js"></script>',
  '<script type="module" src="./parameter-control.js"></script>',
  '<script type="module" src="./parameter-classification.js"></script>',
  '<script type="module" src="./adaptive-learning.js"></script>',
  '<script type="module" src="./security-detail.js"></script>',
  '<script type="module" src="./mobile-task-flow.js"></script>',
]) {
  if (!index.includes(marker)) index = index.replace('</body>', `  ${marker}\n  </body>`);
}
await writeFile(indexPath, index, 'utf-8');
console.log('Built ValueScope Japan into web/dist');
