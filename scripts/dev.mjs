import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
const root = path.resolve('public');
const routes = new Set(['/api/config', '/api/pix/create', '/api/pix/status', '/api/pix/webhook', '/api/receipt']);
const mime = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml', '.woff2': 'font/woff2' };
const server = http.createServer(async (req, res) => {
  const pathname = new URL(req.url, 'http://localhost').pathname;
  try {
    if (routes.has(pathname)) {
      let body = '';
      for await (const chunk of req) { body += chunk; if (body.length > 16384) { res.writeHead(413).end(); return; } }
      req.body = body || undefined;
      res.status = code => { res.statusCode = code; return res; };
      res.json = data => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(data)); };
      const handler = (await import(pathToFileURL(path.resolve(`.${pathname}.js`)).href)).default;
      return handler(req, res);
    }
    const target = ['/', '/checkout', '/aulao/'].includes(pathname) ? '/index.html' : pathname;
    const file = path.resolve(root, `.${decodeURIComponent(target)}`);
    if (!file.startsWith(root + path.sep)) { res.writeHead(403).end(); return; }
    const data = await readFile(file);
    res.writeHead(200, { 'Content-Type': mime[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' }); res.end(data);
  } catch { res.writeHead(404, { 'Content-Type': 'text/plain' }).end('Página não encontrada.'); }
});
server.listen(3000, '127.0.0.1', () => console.log('Local: http://127.0.0.1:3000'));
