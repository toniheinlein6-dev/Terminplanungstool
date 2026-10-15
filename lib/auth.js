// Passwörter (scrypt) und Sitzungs-Cookie (HMAC-signiert)
import crypto from 'node:crypto';
import { q } from './db.js';

const COOKIE = 'tp_session';
const MAX_AGE = 14 * 24 * 3600;   // 14 Tage

function secret() {
  const s = process.env.SESSION_SECRET || '';
  if (s.length < 32) throw Object.assign(new Error('SESSION_SECRET fehlt oder ist kürzer als 32 Zeichen'), { expose: true });
  return s;
}
export function hashPw(pw) {
  const salt = crypto.randomBytes(16);
  const key = crypto.scryptSync(pw, salt, 64, { N: 16384, r: 8, p: 1 });
  return 'scrypt$' + salt.toString('hex') + '$' + key.toString('hex');
}
export function verifyPw(pw, stored) {
  const [alg, salt, hex] = String(stored).split('$');
  if (alg !== 'scrypt' || !salt || !hex) return false;
  const key = crypto.scryptSync(pw, Buffer.from(salt, 'hex'), 64, { N: 16384, r: 8, p: 1 });
  const want = Buffer.from(hex, 'hex');
  return want.length === key.length && crypto.timingSafeEqual(want, key);
}
const mac = s => crypto.createHmac('sha256', secret()).update(s).digest('base64url');
export function makeToken(uid, ver) {
  const payload = uid + '.' + ver + '.' + (Date.now() + MAX_AGE * 1000);
  return payload + '.' + mac(payload);
}
function readToken(tok) {
  const parts = String(tok || '').split('.'); if (parts.length !== 4) return null;
  const payload = parts.slice(0, 3).join('.'), sig = Buffer.from(parts[3]), good = Buffer.from(mac(payload));
  if (sig.length !== good.length || !crypto.timingSafeEqual(sig, good)) return null;
  const [uid, ver, exp] = parts.slice(0, 3).map(Number);
  if (!Number.isInteger(uid) || !(exp > Date.now())) return null;
  return { uid, ver };
}
function cookies(req) {
  const out = {}; String(req.headers.cookie || '').split(';').forEach(c => { const i = c.indexOf('='); if (i > 0) out[c.slice(0, i).trim()] = decodeURIComponent(c.slice(i + 1).trim()); });
  return out;
}
function secure(req) {
  const host = String(req.headers.host || '');
  return (req.headers['x-forwarded-proto'] || '').includes('https') || !/^(localhost|127\.0\.0\.1)(:\d+)?$/.test(host);
}
export function setSession(req, res, uid, ver) {
  res.setHeader('Set-Cookie', COOKIE + '=' + makeToken(uid, ver) + '; Path=/; HttpOnly; SameSite=Lax; Max-Age=' + MAX_AGE + (secure(req) ? '; Secure' : ''));
}
export function clearSession(req, res) {
  res.setHeader('Set-Cookie', COOKIE + '=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0' + (secure(req) ? '; Secure' : ''));
}
export async function currentUser(req) {
  const t = readToken(cookies(req)[COOKIE]); if (!t) return null;
  const r = await q('SELECT id, name, role, token_ver FROM tp_users WHERE id = $1', [t.uid]);
  const u = r.rows[0];
  return u && Number(u.token_ver) === t.ver ? { id: Number(u.id), name: u.name, role: u.role, token_ver: Number(u.token_ver) } : null;
}
