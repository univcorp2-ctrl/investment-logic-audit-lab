import { cp, mkdir, rm, stat } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const dist = resolve(root, 'dist');
await rm(dist, { recursive: true, force: true });
await mkdir(dist, { recursive: true });
for (const file of ['index.html', 'styles.css', 'app.js', 'scoring.js', 'demo-data.js']) {
  await cp(resolve(root, file), resolve(dist, file));
}
for (const file of ['live-ranking.json', 'live-ranking.csv']) {
  try {
    await stat(resolve(root, file));
    await cp(resolve(root, file), resolve(dist, file));
  } catch {
    // The first build may happen before the scheduled data job has produced the file.
  }
}
console.log('Built ValueScope Japan into web/dist');
