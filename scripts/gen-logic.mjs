// Erzeugt lib/logic.cjs aus src/logic.js, damit der Server dieselbe Terminberechnung nutzt wie die Oberfläche
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = fs.readFileSync(path.join(root, 'src', 'logic.js'), 'utf8');
const out = '// Automatisch erzeugt aus src/logic.js (npm run build), nicht von Hand ändern\n' + src +
  '\nmodule.exports = { schedule, parseISO, toISO, dn, ymd, fmt, fmtLong, isoWd };\n';
fs.writeFileSync(path.join(root, 'lib', 'logic.cjs'), out);
