// Die JSON-Datei bleibt lesbar; große Sicherungen werden nur beim Transport komprimiert.
import { gzipSync, gunzipSync } from 'node:zlib';
import { TextDecoder } from 'node:util';

export const MAX_BACKUP_BYTES = 64_000_000;
export const MAX_COMPRESSED_BACKUP_BYTES = 3_000_000;
export const MAX_REQUEST_BYTES = 4_200_000;

function tooLarge(fail) {
  fail(413, 'Die Sicherung ist zu groß (höchstens 64 MB JSON und 3 MB komprimiert). Bitte die Datenbank direkt sichern.');
}

export function prepareBackupExport(value, fail) {
  const json = Buffer.from(JSON.stringify(value), 'utf8');
  if (json.length > MAX_BACKUP_BYTES) tooLarge(fail);
  const gzip = gzipSync(json);
  if (gzip.length > MAX_COMPRESSED_BACKUP_BYTES) tooLarge(fail);
  return { json, gzip };
}

export function acceptsGzip(header) {
  const encodings = new Map();
  for (const entry of String(header || '').split(',')) {
    const [name, ...parameters] = entry.trim().toLowerCase().split(';');
    if (!name) continue;
    const quality = parameters.map(part => part.trim()).find(part => part.startsWith('q='));
    const q = quality ? Number(quality.slice(2)) : 1;
    encodings.set(name, Number.isFinite(q) && q >= 0 && q <= 1 ? q : 0);
  }
  return (encodings.get('gzip') ?? encodings.get('*') ?? 0) > 0;
}

export function unpackBackup(value, fail) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(400, 'Ungültige Sicherung');
  if (!Object.hasOwn(value, 'backupEncoding')) return value;
  if (value.backupEncoding !== 'gzip-base64' || Object.keys(value).some(key => !['backupEncoding', 'data'].includes(key)) || typeof value.data !== 'string' || !value.data.length) {
    fail(400, 'Ungültiges Sicherungsformat');
  }
  const data = value.data;
  if (data.length > Math.ceil(MAX_COMPRESSED_BACKUP_BYTES / 3) * 4) tooLarge(fail);
  if (data.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(data)) fail(400, 'Ungültige Base64-Sicherung');
  const compressed = Buffer.from(data, 'base64');
  if (compressed.length > MAX_COMPRESSED_BACKUP_BYTES) tooLarge(fail);
  if (compressed.toString('base64') !== data) fail(400, 'Ungültige Base64-Sicherung');
  let decoded;
  try { decoded = gunzipSync(compressed, { maxOutputLength: MAX_BACKUP_BYTES }); }
  catch (error) {
    if (error.code === 'ERR_BUFFER_TOO_LARGE') tooLarge(fail);
    fail(400, 'Die komprimierte Sicherung ist beschädigt oder kein gültiges gzip-Archiv.');
  }
  if (decoded.length > MAX_BACKUP_BYTES) tooLarge(fail);
  let backup;
  try { backup = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(decoded)); }
  catch { fail(400, 'Die komprimierte Sicherung enthält kein gültiges UTF-8-JSON.'); }
  if (!backup || typeof backup !== 'object' || Array.isArray(backup) || Object.hasOwn(backup, 'backupEncoding')) fail(400, 'Ungültige Sicherung');
  return backup;
}
