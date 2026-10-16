// Vercel Cron (siehe vercel.json): verschickt täglich die Erinnerungen, montags zusätzlich die Wochenübersicht. Vercel sendet dabei „Authorization: Bearer <CRON_SECRET>“.
import { ensureSchema } from '../lib/db.js';
import { runReminders } from '../lib/reminders.js';
import { runWeekly } from '../lib/weekly.js';

export default async function handler(req, res) {
  const secret = process.env.CRON_SECRET || '';
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  if (secret.length < 16 || req.headers.authorization !== 'Bearer ' + secret) { res.statusCode = 401; return res.end('{"error":"nicht berechtigt"}'); }
  try { await ensureSchema(); const r = await runReminders(); const w = await runWeekly(); res.statusCode = 200; res.end(JSON.stringify({ reminders: r, weekly: w })); }
  catch (e) { console.error('Erinnerungen:', e); res.statusCode = 500; res.end('{"error":"Serverfehler"}'); }
}
