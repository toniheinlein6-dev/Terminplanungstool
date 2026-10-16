// Passwörter (scrypt, OWASP-Parameter) und serverseitige Sitzungen
// Sitzung: zufällige ID (256 Bit) im Cookie, in der Datenbank nur ihr SHA-256-Hash.
// Ablauf nach Inaktivität (IDLE) und spätestens nach ABS; Abmelden löscht die Sitzung serverseitig.
import crypto from 'node:crypto';
import { promisify } from 'node:util';
import { q } from './db.js';
import { secret, sha256, hmac, safeEqual, now } from './security.js';

const scrypt = promisify(crypto.scrypt);
// OWASP Password Storage Cheat Sheet: scrypt mit N=2^17, r=8, p=1 (Argon2id bräuchte eine native Zusatzbibliothek)
const N = 131072, R = 8, P = 1, KEYLEN = 64, MAXMEM = 256 * 1024 * 1024;
const LEGACY = { N: 16384, r: 8, p: 1 };

export const IDLE = 3 * 24 * 3600;       // 3 Tage ohne Nutzung
export const ABS = 14 * 24 * 3600;       // höchstens 14 Tage, dann neu anmelden
const TOUCH = 300;                       // „zuletzt aktiv“ höchstens alle 5 Minuten schreiben
const LEGACY_COOKIE = 'tp_session';

export async function hashPw(pw) {
  const salt = crypto.randomBytes(16);
  const key = await scrypt(String(pw).normalize('NFC'), salt, KEYLEN, { N, r: R, p: P, maxmem: MAXMEM });
  return ['scrypt', N, R, P, salt.toString('hex'), key.toString('hex')].join('$');
}
function parseHash(stored) {
  const p = String(stored || '').split('$');
  if (p[0] !== 'scrypt') return null;
  if (p.length === 3) return { ...LEGACY, salt: p[1], hex: p[2], legacy: true };   // altes Format: scrypt$salt$hash
  if (p.length === 6) return { N: Number(p[1]), r: Number(p[2]), p: Number(p[3]), salt: p[4], hex: p[5] };
  return null;
}
export async function verifyPw(pw, stored) {
  const h = parseHash(stored); if (!h || !h.salt || !h.hex || h.N > 1 << 20) return false;
  const want = Buffer.from(h.hex, 'hex');
  const key = await scrypt(h.legacy ? String(pw) : String(pw).normalize('NFC'), Buffer.from(h.salt, 'hex'), want.length || KEYLEN, { N: h.N, r: h.r, p: h.p, maxmem: MAXMEM });
  return want.length === key.length && crypto.timingSafeEqual(want, key);
}
export function needsRehash(stored) { const h = parseHash(stored); return !h || h.legacy || h.N !== N || h.r !== R || h.p !== P; }
// Gleiche Rechenzeit, wenn es den Benutzer nicht gibt (kein Rückschluss auf vorhandene Namen über die Antwortzeit)
let dummy = null;
export async function dummyVerify(pw) { if (!dummy) dummy = await hashPw('dummy-' + crypto.randomBytes(8).toString('hex')); await verifyPw(pw, dummy); }

// ---- Cookies ----
function cookies(req) {
  const out = {};
  String(req.headers.cookie || '').split(';').forEach(c => { const i = c.indexOf('='); if (i > 0) { try { out[c.slice(0, i).trim()] = decodeURIComponent(c.slice(i + 1).trim()); } catch (e) { } } });
  return out;
}
export function isSecure(req) {
  const host = String(req.headers.host || '');
  return String(req.headers['x-forwarded-proto'] || '').includes('https') || !/^(localhost|127\.0\.0\.1)(:\d+)?$/.test(host);
}
// __Host-: nur über HTTPS, nur für genau diesen Host, Pfad / (lokal über http ohne Präfix)
const cookieName = req => isSecure(req) ? '__Host-tp_sid' : 'tp_sid';
function appendCookie(res, c) {
  const prev = res.getHeader('Set-Cookie'); res.setHeader('Set-Cookie', prev ? [].concat(prev, c) : [c]);
}
function writeCookie(req, res, name, value, maxAge) {
  appendCookie(res, name + '=' + value + '; Path=/; HttpOnly; SameSite=Strict; Max-Age=' + maxAge + (isSecure(req) ? '; Secure' : ''));
}

// ---- Sitzungen ----
export async function createSession(req, res, uid) {
  const id = crypto.randomBytes(32).toString('base64url'), t = now();
  await q('INSERT INTO tp_sessions (id, user_id, created_at, last_seen) VALUES ($1,$2,$3,$3)', [sha256(id), uid, t]);
  writeCookie(req, res, cookieName(req), id, ABS);
  return sha256(id);
}
export async function destroySession(req, res) {
  const id = cookies(req)[cookieName(req)];
  if (id) await q('DELETE FROM tp_sessions WHERE id = $1', [sha256(id)]);
  writeCookie(req, res, cookieName(req), '', 0);
  if (cookies(req)[LEGACY_COOKIE]) writeCookie(req, res, LEGACY_COOKIE, '', 0);
}
// Alle Sitzungen eines Benutzers beenden (Passwort- oder Rollenänderung, Löschung), optional bis auf eine
export async function destroyUserSessions(uid, keepSid) {
  if (keepSid) await q('DELETE FROM tp_sessions WHERE user_id = $1 AND id <> $2', [uid, keepSid]);
  else await q('DELETE FROM tp_sessions WHERE user_id = $1', [uid]);
}
// CSRF-Token: an die Sitzung gebunden (HMAC der Sitzungs-ID-Prüfsumme), ändert sich mit jeder neuen Sitzung
export const csrfToken = sid => hmac('csrf', sid);
export const csrfOk = (sid, tok) => !!sid && safeEqual(csrfToken(sid), tok);

// Alte HMAC-Cookies (vor der Umstellung) einmalig in eine neue Sitzung überführen
function readLegacy(tok) {
  const parts = String(tok || '').split('.'); if (parts.length !== 4) return null;
  const payload = parts.slice(0, 3).join('.');
  const mac = crypto.createHmac('sha256', secret()).update(payload).digest('base64url');
  if (!safeEqual(mac, parts[3])) return null;
  const [uid, ver, exp] = parts.slice(0, 3).map(Number);
  return Number.isInteger(uid) && exp > Date.now() ? { uid, ver } : null;
}

export async function currentUser(req, res) {
  const c = cookies(req), raw = c[cookieName(req)], t = now();
  if (raw && raw.length <= 100) {
    const sid = sha256(raw);
    const r = await q('SELECT s.id, s.created_at, s.last_seen, u.id AS uid, u.name, u.role FROM tp_sessions s JOIN tp_users u ON u.id = s.user_id WHERE s.id = $1', [sid]);
    const s = r.rows[0];
    if (s) {
      if (Number(s.created_at) < t - ABS || Number(s.last_seen) < t - IDLE) { await q('DELETE FROM tp_sessions WHERE id = $1', [sid]); return null; }
      if (Number(s.last_seen) < t - TOUCH) await q('UPDATE tp_sessions SET last_seen = $1 WHERE id = $2', [t, sid]);
      return { id: Number(s.uid), name: s.name, role: s.role, sid };
    }
  }
  if (res && c[LEGACY_COOKIE]) {
    const lt = readLegacy(c[LEGACY_COOKIE]);
    writeCookie(req, res, LEGACY_COOKIE, '', 0);
    if (lt) {
      const u = (await q('SELECT id, name, role, token_ver FROM tp_users WHERE id = $1', [lt.uid])).rows[0];
      if (u && Number(u.token_ver) === lt.ver) { const sid = await createSession(req, res, Number(u.id)); return { id: Number(u.id), name: u.name, role: u.role, sid }; }
    }
  }
  return null;
}
