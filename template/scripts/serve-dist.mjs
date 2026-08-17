/**
 * Minimal static server for dist/, used by the budgets gate.
 *
 * Dependency-free on purpose: this repo's whole argument is that a build pipeline should
 * not quietly acquire packages, and pulling one in just to point Lighthouse at a folder
 * would contradict that on line one.
 */
import { createServer } from 'node:http';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';

const ROOT = join(process.cwd(), 'dist');
const PORT = Number(process.env.PORT || 4173);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.xml': 'application/xml',
  '.txt': 'text/plain; charset=utf-8',
};

/**
 * Starts the server and resolves once it is listening.
 *
 * @param {number} [port]
 * @returns {Promise<import('node:http').Server>}
 */
export function startServer(port = PORT) {
  const server = createServer((req, res) => {
    const path = decodeURIComponent((req.url || '/').split('?')[0]);
    let file = join(ROOT, path);
    let missing = false;
    try {
      if (statSync(file).isDirectory()) file = join(file, 'index.html');
    } catch {
      missing = true;
    }
    if (!existsSync(file)) missing = true;
    if (missing) file = join(ROOT, '404.html');

    try {
      // A miss is served with a real 404 status, so a budget run measures what a visitor
      // would actually receive rather than a 200 that happens to say "not found".
      res.writeHead(missing ? 404 : 200, {
        'Content-Type': MIME[extname(file)] || 'application/octet-stream',
      });
      res.end(readFileSync(file));
    } catch {
      res.writeHead(500);
      res.end('error');
    }
  });
  return new Promise((resolve) => server.listen(port, () => resolve(server)));
}

// Only when run directly (`npm run serve:dist`), not when imported by with-server.mjs.
if (import.meta.url === `file://${process.argv[1]?.replace(/\\/g, '/')}`) {
  startServer().then(() => console.log(`serving dist/ on http://127.0.0.1:${PORT}`));
}
