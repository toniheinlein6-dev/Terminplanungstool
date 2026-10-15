// Lokaler Testserver: node scripts/dev-server.mjs  (ohne DATABASE_URL läuft eine Datenbank im Arbeitsspeicher)
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
process.env.SESSION_SECRET ||= 'nur-fuer-die-lokale-entwicklung-0123456789abcdef';
process.env.SETUP_KEY ||= 'lokal1234';
if (!process.env.DATABASE_URL) {
  const { newDb } = await import('pg-mem');
  const { setPool } = await import('../lib/db.js');
  const mem = newDb(); const { Pool } = mem.adapters.createPg(); setPool(new Pool());
  console.log('Datenbank: im Arbeitsspeicher (Daten gehen beim Beenden verloren). SETUP_KEY =', process.env.SETUP_KEY);
}
const handler = (await import('../lib/handler.js')).default;
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml', '.json': 'application/json' };
const port = Number(process.env.PORT || 3000);
http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://localhost');
  if (u.pathname === '/api/tp') return handler(req, res);
  let f = path.normalize(decodeURIComponent(u.pathname)).replace(/^([/\\])+/, '');
  if (!f) f = 'index.html';
  const full = path.join(root, 'public', f);
  if (!full.startsWith(path.join(root, 'public')) || !fs.existsSync(full) || fs.statSync(full).isDirectory()) { res.statusCode = 404; return res.end('Nicht gefunden'); }
  res.setHeader('Content-Type', types[path.extname(full)] || 'application/octet-stream');
  fs.createReadStream(full).pipe(res);
}).listen(port, () => console.log('Terminplaner läuft auf http://localhost:' + port));
