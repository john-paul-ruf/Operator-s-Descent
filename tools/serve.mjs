import http from 'node:http';
import { createReadStream, promises as fs } from 'node:fs';
import { dirname, extname, join, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = normalize(join(dirname(fileURLToPath(import.meta.url)), '..'));
const args = new Map(process.argv.slice(2).map((arg, index, list) => arg.startsWith('--') ? [arg.slice(2), list[index + 1]] : [arg, true]));
const HOST = args.get('host') || process.env.HOST || '127.0.0.1';
const PORT = Number(args.get('port') || process.env.PORT || 4173);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.woff2': 'font/woff2',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8'
};

function send(res, status, body, headers = {}) {
  res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-cache', ...headers });
  res.end(body);
}

function requestPath(req) {
  const url = new URL(req.url || '/', `http://${req.headers.host || `${HOST}:${PORT}`}`);
  const decoded = decodeURIComponent(url.pathname);
  return decoded.endsWith('/') ? `${decoded}index.html` : decoded;
}

const server = http.createServer(async (req, res) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'Method Not Allowed');

  let relativePath;
  try {
    relativePath = requestPath(req);
  } catch {
    return send(res, 400, 'Bad Request');
  }

  const filePath = normalize(join(ROOT, relativePath));
  if (filePath !== ROOT && !filePath.startsWith(ROOT + sep)) return send(res, 403, 'Forbidden');

  try {
    const stat = await fs.stat(filePath);
    if (!stat.isFile()) return send(res, 404, `Not found: ${relativePath}`);
    const type = MIME[extname(filePath).toLowerCase()] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': type, 'Content-Length': stat.size, 'Cache-Control': 'no-cache' });
    if (req.method === 'HEAD') return res.end();
    createReadStream(filePath).pipe(res);
  } catch {
    send(res, 404, `Not found: ${relativePath}`);
  }
});

server.listen(PORT, HOST, () => {
  console.log(`Serving ${ROOT} at http://${HOST}:${PORT}/`);
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => server.close(() => process.exit(0)));
}
