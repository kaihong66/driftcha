#!/usr/bin/env node
// Standalone mock server: the API from ./api.js plus the built demo from ../dist.
//   npm run serve          build, then start on http://localhost:8787
//   PORT=3000 npm start    start without rebuilding
// DRIFTCHA_SECRET sets a fixed HMAC key for pass tokens (random per process otherwise).

import http from 'node:http';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApi } from './api.js';

const ROOT = resolve(fileURLToPath(new URL('../dist', import.meta.url)));
const PORT = Number(process.env.PORT) || 8787;
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.json': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8'
};

const api = createApi({ secret: process.env.DRIFTCHA_SECRET });

function serveStatic(req, res) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405).end();
    return;
  }
  let path;
  try {
    path = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  } catch {
    res.writeHead(400).end();
    return;
  }
  if (path.endsWith('/')) path += 'index.html';

  const file = resolve(ROOT, `.${path}`);
  if (file !== ROOT && !file.startsWith(ROOT + sep)) {
    res.writeHead(403).end();
    return;
  }
  let stat;
  try {
    stat = statSync(file);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Not found');
    return;
  }
  if (!stat.isFile()) {
    res.writeHead(404).end();
    return;
  }
  res.writeHead(200, {
    'Content-Type': TYPES[extname(file)] ?? 'application/octet-stream',
    'Content-Length': stat.size
  });
  if (req.method === 'HEAD') res.end();
  else createReadStream(file).pipe(res);
}

const server = http.createServer((req, res) => api.middleware(req, res, () => serveStatic(req, res)));

server.listen(PORT, () => {
  console.log(`Driftcha mock server running at http://localhost:${PORT}`);
  if (!existsSync(resolve(ROOT, 'index.html'))) {
    console.log('dist/ not found: the API works, but run `npm run build` to serve the demo page.');
  }
});

const shutdown = () => {
  api.close();
  server.close(() => process.exit(0));
  server.closeAllConnections?.();
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
