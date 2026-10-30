// Local dev server. On Vercel, api/index.js is used instead.
const http = require('http');
const fs = require('fs');
const path = require('path');
try { process.loadEnvFile(path.join(__dirname, '.env')); } catch { /* no .env file */ }
const handler = require('./lib/handler');

const PORT = process.env.PORT || 3000;
const PUBLIC = path.join(__dirname, 'public');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.json': 'application/json', '.png': 'image/png' };

http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname.startsWith('/api/')) return handler(req, res);
  let f = path.normalize(path.join(PUBLIC, url.pathname === '/' ? 'index.html' : url.pathname));
  if (!f.startsWith(PUBLIC) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) f = path.join(PUBLIC, 'index.html');
  res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream', 'X-Content-Type-Options': 'nosniff' });
  fs.createReadStream(f).pipe(res);
}).listen(PORT, '0.0.0.0', () => {
  const nets = Object.values(require('os').networkInterfaces()).flat().filter(n => n.family === 'IPv4' && !n.internal);
  console.log(`Firecracker billing running:\n  http://localhost:${PORT}`);
  nets.forEach(n => console.log(`  http://${n.address}:${PORT}   (mobile, same Wi-Fi)`));
});
