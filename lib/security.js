// Sicherheitsbausteine: Client-IP (pseudonymisiert), Ratenbegrenzung, Sicherheitsprotokoll,
// Herkunftsprüfung (Origin / Fetch-Metadata), Passwortrichtlinie mit Prüfung gegen bekannte Leaks.
import crypto from 'node:crypto';
import { q } from './db.js';

export class HttpError extends Error { constructor(code, msg, extra) { super(msg); this.code = code; this.extra = extra; } }
export const fail = (code, msg, extra) => { throw new HttpError(code, msg, extra); };
export const now = () => Math.floor(Date.now() / 1000);

export function secret() {
  const s = process.env.SESSION_SECRET || '';
  if (s.length < 32) throw Object.assign(new Error('SESSION_SECRET fehlt oder ist kürzer als 32 Zeichen'), { expose: true });
  return s;
}
export const hmac = (label, v) => crypto.createHmac('sha256', secret()).update(label + '\u0000' + v).digest('base64url');
export const sha256 = v => crypto.createHash('sha256').update(v).digest('hex');
export function safeEqual(a, b) {
  const x = Buffer.from(String(a ?? '')), y = Buffer.from(String(b ?? ''));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

// Vercel setzt x-vercel-forwarded-for / x-real-ip selbst (vom Client nicht fälschbar); lokal die Socket-Adresse
export function clientIp(req) {
  const h = req.headers || {};
  const v = h['x-vercel-forwarded-for'] || h['x-real-ip'] || String(h['x-forwarded-for'] || '').split(',')[0] || req.socket?.remoteAddress || '';
  return String(v).trim().slice(0, 64);
}
// IP-Adressen werden nur pseudonymisiert gespeichert (HMAC, nicht umkehrbar ohne Server-Geheimnis)
export const ipTag = req => hmac('ip', clientIp(req)).slice(0, 16);

// ---- Ratenbegrenzung: gleitendes Fenster in der Datenbank (funktioniert über alle Serverless-Instanzen) ----
export async function hits(key, windowSec) {
  const r = await q('SELECT COUNT(*)::int AS n FROM tp_rate WHERE k = $1 AND at >= $2', [key, now() - windowSec]);
  return Number(r.rows[0].n);
}
export async function hit(key) { await q('INSERT INTO tp_rate (k, at) VALUES ($1, $2)', [key, now()]); }
// Zählt den Versuch und bricht mit 429 ab, wenn das Limit erreicht ist
export async function limit(req, key, max, windowSec, msg) {
  if (await hits(key, windowSec) >= max) {
    await secLog(req, 'rate_limit', null, key.split(':')[0]);
    fail(429, msg || 'Zu viele Anfragen. Bitte warte einen Moment und versuche es dann erneut.');
  }
  await hit(key);
}

// ---- Sicherheitsprotokoll (Datenbank statt Datei: Vercel hat kein beschreibbares Dateisystem) ----
// Keine Passwörter, Tokens, Sitzungs-IDs oder E-Mail-Adressen; IP nur pseudonymisiert; Steuerzeichen entfernt
const clean = s => String(s ?? '').replace(/[\u0000-\u001f\u007f\u2028\u2029]/g, ' ').slice(0, 300);
export async function secLog(req, kind, userId, detail) {
  try {
    await q('INSERT INTO tp_seclog (at, kind, user_id, ip, detail) VALUES ($1,$2,$3,$4,$5)',
      [now(), clean(kind).slice(0, 32), userId == null ? null : Number(userId), req ? ipTag(req) : null, clean(detail)]);
  } catch (e) { console.error('Sicherheitsprotokoll:', e.message); }
}

// ---- Herkunft prüfen: nur Anfragen aus der eigenen Seite (ergänzt CSRF-Token und X-TP-Kopfzeile) ----
export function sameOrigin(req) {
  const h = req.headers || {};
  const site = String(h['sec-fetch-site'] || '');
  if (site && site !== 'same-origin' && site !== 'none') return false;
  const origin = String(h.origin || '');
  if (!origin || origin === 'null') return !site || site === 'same-origin';   // ältere Browser ohne Origin bei same-origin
  let o; try { o = new URL(origin); } catch (e) { return false; }
  const host = String(h['x-forwarded-host'] || h.host || '').split(',')[0].trim().toLowerCase();
  return o.host.toLowerCase() === host;
}

// ---- Passwortrichtlinie ----
export const PW_MIN = 12, PW_MAX = 256;
const COMMON = new Set(['passwort1234', 'password1234', 'passwort12345', 'password12345', '123456789012', 'qwertzuiop12', 'qwertyuiop12', 'hallo1234567', 'terminplaner1', 'terminplaner', 'ichliebedich1', 'sommer2026!!', 'winter2026!!']);
async function pwnedCount(pw) {
  if (process.env.PWNED_CHECK === 'off') return 0;
  // k-Anonymität: nur die ersten 5 Zeichen des SHA-1-Hashes verlassen den Server
  const h = crypto.createHash('sha1').update(pw).digest('hex').toUpperCase(), pre = h.slice(0, 5), suf = h.slice(5);
  const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), 2500);
  try {
    const r = await fetch('https://api.pwnedpasswords.com/range/' + pre, { headers: { 'Add-Padding': 'true' }, signal: ctl.signal });
    if (!r.ok) return 0;
    for (const line of (await r.text()).split('\n')) { const [s, n] = line.trim().split(':'); if (s === suf) return Number(n) || 0; }
    return 0;
  } catch (e) { return 0; }   // Dienst nicht erreichbar: Prüfung entfällt, Länge und Liste gelten weiter
  finally { clearTimeout(t); }
}
export async function checkNewPassword(pw, name) {
  pw = String(pw || '');
  if (pw.length < PW_MIN) fail(400, 'Das Passwort braucht mindestens ' + PW_MIN + ' Zeichen. Tipp: mehrere Wörter als Satz.');
  if (pw.length > PW_MAX) fail(400, 'Das Passwort darf höchstens ' + PW_MAX + ' Zeichen haben.');
  const low = pw.toLowerCase();
  if (name && low.includes(String(name).trim().toLowerCase()) && String(name).trim().length >= 3) fail(400, 'Das Passwort darf den Namen nicht enthalten.');
  if (COMMON.has(low) || /^(.)\1+$/.test(pw)) fail(400, 'Dieses Passwort ist zu leicht zu erraten.');
  if (await pwnedCount(pw) > 0) fail(400, 'Dieses Passwort ist aus Datenlecks bekannt. Bitte ein anderes wählen.');
}

// ---- Profilbilder: echten Inhalt prüfen, Maße begrenzen, Metadaten (EXIF/GPS, Kommentare) entfernen ----
const MAX_SIDE = 1024;
function jpegInfo(b) {
  if (b[0] !== 0xff || b[1] !== 0xd8 || b[2] !== 0xff) return null;
  const out = [b.subarray(0, 2)]; let i = 2, w = 0, h = 0;
  while (i + 4 <= b.length) {
    if (b[i] !== 0xff) return null;
    const m = b[i + 1];
    if (m === 0xd9) { out.push(b.subarray(i, i + 2)); break; }
    if (m === 0xda) { out.push(b.subarray(i)); i = b.length; break; }   // Bilddaten bis zum Ende übernehmen
    if (m === 0xd8 || (m >= 0xd0 && m <= 0xd7) || m === 0x01) { out.push(b.subarray(i, i + 2)); i += 2; continue; }
    const len = b.readUInt16BE(i + 2); if (len < 2 || i + 2 + len > b.length) return null;
    if ((m >= 0xc0 && m <= 0xcf) && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) { h = b.readUInt16BE(i + 5); w = b.readUInt16BE(i + 7); }
    const meta = (m >= 0xe1 && m <= 0xef) || m === 0xfe;   // APP1–APP15 (EXIF, XMP, ICC …) und Kommentare entfallen
    if (!meta) out.push(b.subarray(i, i + 2 + len));
    i += 2 + len;
  }
  return w && h ? { w, h, data: Buffer.concat(out) } : null;
}
function pngInfo(b) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (b.length < 33 || !b.subarray(0, 8).equals(sig)) return null;
  const out = [sig]; let i = 8, w = 0, h = 0, end = false;
  while (i + 12 <= b.length) {
    const len = b.readUInt32BE(i), type = b.toString('latin1', i + 4, i + 8); if (i + 12 + len > b.length) return null;
    if (type === 'IHDR') { w = b.readUInt32BE(i + 8); h = b.readUInt32BE(i + 12); }
    if (!['tEXt', 'zTXt', 'iTXt', 'eXIf', 'tIME'].includes(type)) out.push(b.subarray(i, i + 12 + len));
    i += 12 + len; if (type === 'IEND') { end = true; break; }
  }
  return end && w && h ? { w, h, data: Buffer.concat(out) } : null;
}
function webpInfo(b) {
  if (b.length < 30 || b.toString('latin1', 0, 4) !== 'RIFF' || b.toString('latin1', 8, 12) !== 'WEBP') return null;
  const out = []; let i = 12, w = 0, h = 0;
  while (i + 8 <= b.length) {
    const type = b.toString('latin1', i, i + 4), len = b.readUInt32LE(i + 4), pad = len + (len & 1); if (i + 8 + len > b.length) return null;
    const c = Buffer.from(b.subarray(i, i + 8 + pad));
    if (type === 'VP8X') { c[8] &= ~0x0c; w = 1 + c.readUIntLE(12, 3); h = 1 + c.readUIntLE(15, 3); }   // EXIF/XMP-Kennzeichen löschen
    else if (type === 'VP8 ' && !w) { w = c.readUInt16LE(14) & 0x3fff; h = c.readUInt16LE(16) & 0x3fff; }
    else if (type === 'VP8L' && !w) { const v = c.readUInt32LE(9); w = (v & 0x3fff) + 1; h = ((v >> 14) & 0x3fff) + 1; }
    if (type !== 'EXIF' && type !== 'XMP ') out.push(c);
    i += 8 + pad;
  }
  if (!w || !h) return null;
  const body = Buffer.concat(out), head = Buffer.from('RIFF0000WEBP', 'latin1'); head.writeUInt32LE(body.length + 4, 4);
  return { w, h, data: Buffer.concat([head, body]) };
}
// Gibt eine bereinigte data:-URL zurück oder bricht ab (SVG und alles andere wird abgelehnt)
export function cleanImage(dataUrl, maxBytes) {
  const m = /^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/]+={0,2})$/.exec(String(dataUrl || ''));
  if (!m || m[2].length > Math.ceil(maxBytes * 4 / 3) + 4) return null;
  const b = Buffer.from(m[2], 'base64');
  const info = m[1] === 'jpeg' ? jpegInfo(b) : m[1] === 'png' ? pngInfo(b) : webpInfo(b);
  if (!info || info.w > MAX_SIDE || info.h > MAX_SIDE || info.w * info.h > MAX_SIDE * MAX_SIDE) return null;
  return 'data:image/' + m[1] + ';base64,' + info.data.toString('base64');
}
