// Lokaler Testserver: node scripts/dev-server.mjs  (ohne DATABASE_URL läuft eine Datenbank im Arbeitsspeicher)
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
process.env.SESSION_SECRET ||= 'nur-fuer-die-lokale-entwicklung-0123456789abcdef';
process.env.SETUP_KEY ||= 'lokal1234';
if (!process.env.RESEND_API_KEY && !process.env.SMTP_HOST) process.env.MAIL_TRANSPORT ||= 'log';   // E-Mails nur in die Konsole schreiben
if (!process.env.DATABASE_URL) {
  const { newDb } = await import('pg-mem');
  const { setPool } = await import('../lib/db.js');
  const mem = newDb(); const { Pool } = mem.adapters.createPg(); setPool(new Pool());
  console.log('Datenbank: im Arbeitsspeicher (Daten gehen beim Beenden verloren). SETUP_KEY =', process.env.SETUP_KEY);
}
const handler = (await import('../lib/handler.js')).default;
const { sentMails } = await import('../lib/mail.js');
const { runReminders } = await import('../lib/reminders.js');
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml', '.json': 'application/json' };
const port = Number(process.env.PORT || 3000);
http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://localhost');
  if (u.pathname === '/api/tp') return handler(req, res);
  // nur lokal: verschickte Test-Mails ansehen und Erinnerungen für ein Datum auslösen
  if (u.pathname === '/__outbox') { res.setHeader('Content-Type', 'application/json; charset=utf-8'); return res.end(JSON.stringify(sentMails())); }
  if (u.pathname === '/__remind') { const d = u.searchParams.get('day'); const r = await runReminders(d ? { today: Math.round(Date.parse(d + 'T00:00:00Z') / 86400000) } : {}); res.setHeader('Content-Type', 'application/json'); return res.end(JSON.stringify(r)); }
  let f = path.normalize(decodeURIComponent(u.pathname)).replace(/^([/\\])+/, '');
  if (!f) f = 'index.html';
  const full = path.join(root, 'public', f);
  if (!full.startsWith(path.join(root, 'public')) || !fs.existsSync(full) || fs.statSync(full).isDirectory()) { res.statusCode = 404; return res.end('Nicht gefunden'); }
  res.setHeader('Content-Type', types[path.extname(full)] || 'application/octet-stream');
  fs.createReadStream(full).pipe(res);
}).listen(port, () => console.log('Terminplaner läuft auf http://localhost:' + port));
