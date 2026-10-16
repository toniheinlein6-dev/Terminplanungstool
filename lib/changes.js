// Änderungsprotokoll: beim Speichern wird der neue Stand mit dem vorigen verglichen.
// Je Vorgang und Person werden Änderungen innerhalb von 15 Minuten zu einem Eintrag zusammengefasst,
// damit beim Tippen nicht für jeden Speichervorgang ein eigener Eintrag entsteht.
import { q } from './db.js';

const WINDOW = 15 * 60;
const TYPES = { vorgang: 'Vorgang', untervorgang: 'Untervorgang', meilenstein: 'Meilenstein' };
const DEFAULT_LANES = [{ id: '', name: 'Offen' }, { id: 'arbeit', name: 'In Arbeit' }, { id: 'fertig', name: 'Erledigt' }];
export const FIELDS = [['name', 'Bezeichnung'], ['type', 'Typ'], ['who', 'Verantwortlich'], ['pred', 'Vorgänger'], ['rel', 'Beziehung'], ['lag', 'Versatz'],
  ['fixed', 'Fester Start'], ['dur', 'Dauer'], ['st', 'Status'], ['pct', 'Fortschritt'], ['desc', 'Beschreibung'], ['color', 'Farbe']];
const LABEL = Object.fromEntries(FIELDS);
const COLOR_NAMES = { '#3b78c4': 'Blau', '#2a9d8f': 'Türkis', '#4c9a52': 'Grün', '#8a9a2b': 'Oliv', '#d9a520': 'Gelb', '#e07b39': 'Orange', '#c8463d': 'Rot', '#c2508a': 'Pink', '#7d5bb5': 'Lila', '#7b8794': 'Grau' };

const deDate = s => /^\d{4}-\d{2}-\d{2}$/.test(s || '') ? s.slice(8, 10) + '.' + s.slice(5, 7) + '.' + s.slice(0, 4) : '';
function fmtField(k, r, plan) {
  const v = r ? r[k] : undefined;
  switch (k) {
    case 'name': return v ? '„' + String(v).slice(0, 120) + '“' : '–';
    case 'type': return TYPES[v] || '–';
    case 'who': return String(v || '').trim() || '–';
    case 'pred': {
      if (v === '' || v == null) return '–';
      const p = (plan.rows || []).find(x => x && Number(x.id) === Number(v));
      return 'Nr. ' + v + (p && p.name ? ' „' + String(p.name).slice(0, 60) + '“' : '');
    }
    case 'rel': return v || 'EA';
    case 'lag': return v === '' || v == null || Number(v) === 0 ? '–' : (Number(v) > 0 ? '+' : '') + Number(v) + ' T';
    case 'fixed': return deDate(v) || '–';
    case 'dur': return (v === '' || v == null ? '1' : String(v)) + (plan.mode === 'cal' ? ' T' : ' AT');
    case 'st': { const L = Array.isArray(plan.lanes) && plan.lanes.length ? plan.lanes : DEFAULT_LANES; const l = L.find(x => (x.id ?? '') === (v || '')) || L[0]; return l ? l.name : '–'; }
    case 'pct': return (Number(v) || 0) + ' %';
    case 'desc': return String(v || '').trim().slice(0, 200);
    case 'color': return v ? (COLOR_NAMES[String(v).toLowerCase()] || String(v)) : 'Standard';
  }
  return String(v ?? '');
}

function rawField(k, r) {
  const v = r[k];
  switch (k) {
    case 'pred': return v === '' || v == null ? '' : String(Number(v));
    case 'rel': return v || 'EA';
    case 'lag': case 'pct': return String(Number(v) || 0);
    case 'dur': return v === '' || v == null ? '1' : String(v);
    case 'type': return v || '';
    default: return String(v ?? '').trim();
  }
}
// Vergleicht zwei Pläne; liefert je betroffenem Vorgang Aktion und geänderte Felder (formatiert)
export function diffPlans(a, b) {
  const A = new Map((a && Array.isArray(a.rows) ? a.rows : []).filter(r => r && r.id != null).map(r => [Number(r.id), r]));
  const B = new Map((b && Array.isArray(b.rows) ? b.rows : []).filter(r => r && r.id != null).map(r => [Number(r.id), r]));
  const out = [];
  for (const [id, nr] of B) {
    const or = A.get(id), fields = {};
    for (const [k] of FIELDS) {
      // Neuer Vorgang: alles, was vom leeren Vorgang abweicht; sonst Vergleich mit dem alten Stand
      if (rawField(k, or || {}) === rawField(k, nr)) continue;     // verglichen werden Rohwerte, angezeigt Klartext
      fields[k] = [fmtField(k, or || {}, or ? a : b), fmtField(k, nr, b)];
    }
    if (!or) out.push({ rowId: id, name: nr.name || '', action: 'neu', fields });
    else if (Object.keys(fields).length) out.push({ rowId: id, name: nr.name || '', action: 'geändert', fields });
  }
  for (const [id, or] of A) if (!B.has(id)) out.push({ rowId: id, name: or.name || '', action: 'gelöscht', fields: {} });
  return out;
}

export function changeText(action, meta) {
  const order = FIELDS.map(x => x[0]), f = Object.entries((meta && meta.fields) || {}).sort((x, y) => order.indexOf(x[0]) - order.indexOf(y[0]));
  if (action === 'gelöscht') return 'Gelöscht';
  const parts = f.map(([k, [o, n]]) => k === 'desc' ? (action === 'neu' ? 'Beschreibung ergänzt' : 'Beschreibung geändert') : action === 'neu' ? LABEL[k] + ': ' + n : LABEL[k] + ': ' + o + ' → ' + n);
  return action === 'neu' ? 'Angelegt' + (parts.length ? ' · ' + parts.join(' · ') : '') : parts.join(' · ');
}

// Schreibt die Unterschiede zwischen altem und neuem Stand ins Protokoll
export async function recordChanges(pid, oldJson, newJson, uid) {
  let a, b; try { a = JSON.parse(oldJson); b = JSON.parse(newJson); } catch (e) { return 0; }
  const list = diffPlans(a, b).slice(0, 300); if (!list.length) return 0;
  const t = Math.floor(Date.now() / 1000);
  for (const c of list) {
    const prev = (await q('SELECT id, action, meta FROM tp_changes WHERE project_id = $1 AND row_id = $2 AND user_id = $3 AND at >= $4 ORDER BY at DESC, id DESC LIMIT 1', [pid, c.rowId, uid, t - WINDOW])).rows[0];
    let pm = null; if (prev) { try { pm = JSON.parse(prev.meta); } catch (e) { pm = null; } }
    if (prev && pm && prev.action !== 'gelöscht') {
      if (c.action === 'gelöscht') {
        // Eben erst angelegt und gleich wieder gelöscht: gar nicht protokollieren
        if (prev.action === 'neu') { await q('DELETE FROM tp_changes WHERE id = $1', [prev.id]); continue; }
      } else {
        const fields = { ...(pm.fields || {}) };
        for (const [k, [o, n]] of Object.entries(c.fields)) fields[k] = [fields[k] ? fields[k][0] : o, n];
        for (const k of Object.keys(fields)) if (prev.action !== 'neu' && fields[k][0] === fields[k][1]) delete fields[k];
        if (prev.action !== 'neu' && !Object.keys(fields).length) { await q('DELETE FROM tp_changes WHERE id = $1', [prev.id]); continue; }
        await q('UPDATE tp_changes SET at = $1, meta = $2 WHERE id = $3', [t, JSON.stringify({ name: c.name || pm.name || '', fields }), prev.id]);
        continue;
      }
    }
    await q('INSERT INTO tp_changes (project_id, row_id, user_id, first_at, at, action, meta) VALUES ($1,$2,$3,$4,$5,$6,$7)',
      [pid, c.rowId, uid, t, t, c.action, JSON.stringify({ name: c.name, fields: c.fields })]);
  }
  return list.length;
}
