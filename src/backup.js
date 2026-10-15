// Große Sicherungen komprimieren, damit Ticketverläufe innerhalb des Uploadlimits bleiben.
const PLAIN_LIMIT = 3_000_000;
const BACKUP_LIMIT = 64_000_000;
const GZIP_LIMIT = 3_000_000;
const CHUNK_SIZE = 8192;

export async function encodeBackupPayload(value) {
  let json;
  try { json = JSON.stringify(value); }
  catch { throw new Error('Die Sicherung lässt sich nicht als JSON verarbeiten. Bitte verwende eine gültige Sicherungsdatei.'); }
  if (typeof json !== 'string') throw new Error('Die Sicherung enthält keine gültigen JSON-Daten.');
  const bytes = new TextEncoder().encode(json);
  if (bytes.byteLength <= PLAIN_LIMIT) return value;
  if (bytes.byteLength > BACKUP_LIMIT) throw new Error('Die Sicherung ist zu groß. Es werden höchstens 64.000.000 Bytes unkomprimierte JSON-Daten unterstützt.');
  if (typeof CompressionStream !== 'function') throw new Error('Diese Sicherung muss für den Upload komprimiert werden. Dein Browser unterstützt das nicht. Bitte öffne das Tool in einem aktuellen Browser und versuche es erneut.');

  let reader;
  const chunks = [];
  let size = 0;
  try {
    reader = new Blob([bytes]).stream().pipeThrough(new CompressionStream('gzip')).getReader();
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      size += part.value.byteLength;
      if (size > GZIP_LIMIT) {
        await reader.cancel().catch(() => {});
        throw new Error('Die Sicherung ist auch komprimiert zu groß für den Upload. Es werden höchstens 3.000.000 Bytes komprimierte Daten unterstützt.');
      }
      chunks.push(part.value);
    }
  } catch (error) {
    if (size > GZIP_LIMIT) throw error;
    throw new Error('Die Sicherung konnte nicht komprimiert werden. Bitte versuche es erneut.');
  } finally { if (reader) reader.releaseLock(); }

  // Kleine Argumentlisten vermeiden einen Stacküberlauf bei umfangreichen Sicherungen.
  const binaryParts = [];
  for (const chunk of chunks) {
    for (let offset = 0; offset < chunk.byteLength; offset += CHUNK_SIZE) {
      binaryParts.push(String.fromCharCode(...chunk.subarray(offset, offset + CHUNK_SIZE)));
    }
  }
  return { backupEncoding: 'gzip-base64', data: btoa(binaryParts.join('')) };
}
