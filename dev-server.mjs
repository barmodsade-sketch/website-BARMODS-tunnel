import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import vpnHandler from './api/vpn.js';

const ROOT_DIR = dirname(fileURLToPath(import.meta.url));

const STATIC_ROUTES = new Map([
  ['/', { file: 'index.html', contentType: 'text/html; charset=utf-8' }],
  ['/index.html', { file: 'index.html', contentType: 'text/html; charset=utf-8' }],
  ['/barmods-rx-mark.svg', { file: 'barmods-rx-mark.svg', contentType: 'image/svg+xml' }]
]);

function applySecurityHeaders(res) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
}

export function createAppServer() {
  return createServer(async (req, res) => {
    applySecurityHeaders(res);
    const parsedUrl = new URL(req.url || '/', 'http://127.0.0.1');
    const pathname = parsedUrl.pathname;

    if (pathname === '/api/vpn' || pathname === '/api/vpn/') {
      try {
        await vpnHandler(req, res);
      } catch {
        if (!res.headersSent) {
          res.statusCode = 500;
          res.setHeader('Content-Type', 'application/json; charset=utf-8');
          res.end(JSON.stringify({ status: 'error', message: 'Terjadi kesalahan internal pada server.' }));
        }
      }
      return;
    }

    const staticEntry = STATIC_ROUTES.get(pathname);
    if (staticEntry && (req.method === 'GET' || req.method === 'HEAD')) {
      try {
        const content = await readFile(join(ROOT_DIR, staticEntry.file));
        res.statusCode = 200;
        res.setHeader('Content-Type', staticEntry.contentType);
        res.end(req.method === 'HEAD' ? undefined : content);
      } catch {
        res.statusCode = 500;
        res.setHeader('Content-Type', 'text/plain; charset=utf-8');
        res.end('Gagal membaca berkas statis.');
      }
      return;
    }

    res.statusCode = 404;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(JSON.stringify({ status: 'error', message: 'Halaman atau endpoint tidak ditemukan.' }));
  });
}

const isDirectExecution = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isDirectExecution) {
  const port = Number(process.env.PORT || 3000);
  const server = createAppServer();
  server.listen(port, '0.0.0.0', () => {
    process.stdout.write(`Doctor Barmods Console berjalan pada http://127.0.0.1:${port}\n`);
  });
}
