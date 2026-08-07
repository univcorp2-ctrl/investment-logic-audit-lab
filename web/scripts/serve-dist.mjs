import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..', 'dist');
const port = Number(process.env.PORT || 4173);
const host = '127.0.0.1';
const mime = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.csv': 'text/csv; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
};

function safePath(urlPath) {
  const clean = decodeURIComponent(String(urlPath || '/').split('?')[0]).replace(/^\/+/, '');
  const candidate = normalize(join(root, clean || 'index.html'));
  return candidate.startsWith(root) ? candidate : join(root, 'index.html');
}

createServer((request, response) => {
  let path = safePath(request.url);
  if (!existsSync(path) || statSync(path).isDirectory()) path = join(root, 'index.html');
  response.writeHead(200, {
    'Content-Type': mime[extname(path)] || 'application/octet-stream',
    'Cache-Control': 'no-store',
  });
  createReadStream(path).pipe(response);
}).listen(port, host, () => {
  console.log(`ValueScope E2E server: http://${host}:${port}`);
});
