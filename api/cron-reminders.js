// Vercel Cron (siehe vercel.json): verschickt täglich die Erinnerungen, montags zusätzlich die Wochenübersicht,
// und löscht abgelaufene Daten (Aufbewahrungsfristen). Vercel sendet „Authorization: Bearer <CRON_SECRET>“.
import { ensureSchema } from '../lib/db.js';
import { runReminders } from '../lib/reminders.js';
import { runWeekly } from '../lib/weekly.js';
import { cleanup } from '../lib/handler.js';
import { safeEqual } from '../lib/security.js';

export default async function handler(req, res) {
  const secret = process.env.CRON_SECRET || '';
  res.setHeader('Content-Type', 'application/json; charset=utf-8'); res.setHeader('Cache-Control', 'no-store');
  if (secret.length < 16 || !safeEqual(req.headers.authorization || '', 'Bearer ' + secret)) { res.statusCode = 401; return res.end('{"error":"nicht berechtigt"}'); }
  try {
    await ensureSchema();
    const r = await runReminders(), w = await runWeekly(), c = await cleanup();
    res.statusCode = 200; res.end(JSON.stringify({ reminders: r, weekly: w, cleanup: c }));
  } catch (e) { console.error('Erinnerungen:', e); res.statusCode = 500; res.end('{"error":"Serverfehler"}'); }
}
