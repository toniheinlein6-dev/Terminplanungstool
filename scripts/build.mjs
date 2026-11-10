// Baut aus src/ die Webseiten für Vercel (public/), die Claude-Version (claude/) und die Server-Logik (lib/logic.cjs)
import './gen-logic.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const rd = f => fs.readFileSync(path.join(root, 'src', f), 'utf8');
const head = rd('head.html'), body = rd('body.html');
const js = ['logic.js', 'people.js', 'ui.js', 'views.js', 'gantt-ext.js', 'tasks.js', 'org.js', 'touch-dnd.js', 'assignee-picker.js', 'pdf.js', 'shell.js'].map(rd).join('\n');
const app = "(function(){\n'use strict';\n" + js + "\nboot();\n})();\n";

// 1) Website für Vercel: ohne externe Schriften und CDNs (DSGVO), PDF-Baustein lokal
fs.mkdirSync(path.join(root, 'public', 'vendor'), { recursive: true });
const webHead = head
  .replace(/<link[^>]*fonts\.g[^>]*>\n?/g, '')
  .replace('<title>Gantt Terminplaner</title>', '<title>Terminplaner</title>\n<link rel="stylesheet" href="fonts/figtree.css">\n<link rel="stylesheet" href="password-eye.css">\n<link rel="icon" type="image/png" sizes="64x64" href="icons/favicon-64.png">\n<link rel="icon" type="image/png" sizes="32x32" href="icons/favicon-32.png">\n' +
    '<link rel="manifest" href="manifest.webmanifest">\n<link rel="apple-touch-icon" href="icons/apple-touch-icon.png">\n' +
    '<meta name="theme-color" content="#26664b">\n<meta name="mobile-web-app-capable" content="yes">\n<meta name="apple-mobile-web-app-capable" content="yes">\n' +
    '<meta name="apple-mobile-web-app-title" content="Terminplaner">\n<meta name="apple-mobile-web-app-status-bar-style" content="default">\n' +
    '<style>[hidden]{display:none!important}body{margin:0}img{max-width:100%}</style>');
// Keine Inline-Skripte: die Content-Security-Policy erlaubt nur Skripte aus eigenen Dateien (script-src 'self')
fs.writeFileSync(path.join(root, 'public', 'index.html'),
  '<!doctype html>\n<html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">\n' + webHead +
  '\n</head><body>\n' + body + '\n<script src="password-eye.js"></script>\n<script src="app-api.js"></script>\n<script src="app.js"></script>\n</body></html>\n');
for (const f of ['password-eye.js', 'password-eye.css']) fs.copyFileSync(path.join(root, 'src', f), path.join(root, 'public', f));
fs.writeFileSync(path.join(root, 'public', 'app.js'), 'window.JSPDF_SRC = "vendor/jspdf.umd.min.js";\n' + app);
fs.copyFileSync(path.join(root, 'src', 'server-api.js'), path.join(root, 'public', 'app-api.js'));
// Verwaltung und Einrichtung: Skript in eigene Datei auslagern
for (const page of ['admin', 'setup']) {
  const html = rd(page + '.html'), m = /<script>([\s\S]*?)<\/script>/.exec(html);
  if (!m || /<script>/.test(html.slice(m.index + m[0].length))) throw new Error(page + '.html: genau ein Inline-Skript erwartet');
  fs.writeFileSync(path.join(root, 'public', page + '.js'), m[1].trim() + '\n');
  fs.writeFileSync(path.join(root, 'public', page + '.html'), html.replace(m[0], '<script src="' + page + '.js"></script>'));
}
fs.copyFileSync(path.join(root, 'src', 'datenschutz.html'), path.join(root, 'public', 'datenschutz.html'));
// Schrift Figtree lokal (CSP font-src 'self')
fs.mkdirSync(path.join(root, 'public', 'fonts'), { recursive: true });
for (const f of fs.readdirSync(path.join(root, 'src', 'fonts'))) fs.copyFileSync(path.join(root, 'src', 'fonts', f), path.join(root, 'public', 'fonts', f));
// App (PWA): Manifest, Symbole, Service Worker (Version = Prüfsumme der Seite, damit Updates ankommen)
fs.mkdirSync(path.join(root, 'public', 'icons'), { recursive: true });
for (const f of fs.readdirSync(path.join(root, 'src', 'icons'))) fs.copyFileSync(path.join(root, 'src', 'icons', f), path.join(root, 'public', 'icons', f));
fs.copyFileSync(path.join(root, 'src', 'manifest.webmanifest'), path.join(root, 'public', 'manifest.webmanifest'));
fs.copyFileSync(path.join(root, 'node_modules', 'jspdf', 'dist', 'jspdf.umd.min.js'), path.join(root, 'public', 'vendor', 'jspdf.umd.min.js'));
// Aktualisierung installierter Apps: Programmdateien mit Prüfsumme im Namen (?v=…) einbinden, damit eine neue Seite
// nie alte Skripte aus dem Zwischenspeicher bekommt; der Service Worker trägt dieselbe Gesamtversion.
{
  const { createHash } = await import('node:crypto');
  const pub = f => path.join(root, 'public', f), sum = buf => createHash('sha256').update(buf).digest('hex').slice(0, 10);
  const assets = ['app.js', 'app-api.js', 'password-eye.js', 'password-eye.css', 'fonts/figtree.css', 'fonts/figtree-latin.woff2', 'vendor/jspdf.umd.min.js', 'admin.js', 'setup.js'];
  const ver = Object.fromEntries(assets.map(f => [f, sum(fs.readFileSync(pub(f)))]));
  for (const page of ['index.html', 'admin.html', 'setup.html']) {
    let html = fs.readFileSync(pub(page), 'utf8');
    for (const f of assets) html = html.split('"' + f + '"').join('"' + f + '?v=' + ver[f] + '"');
    fs.writeFileSync(pub(page), html);
  }
  // Pfad zum PDF-Baustein ebenfalls mit Version
  fs.writeFileSync(pub('app.js'), fs.readFileSync(pub('app.js'), 'utf8').replace('window.JSPDF_SRC = "vendor/jspdf.umd.min.js";', 'window.JSPDF_SRC = "vendor/jspdf.umd.min.js?v=' + ver['vendor/jspdf.umd.min.js'] + '";'));
  ver['app.js'] = sum(fs.readFileSync(pub('app.js')));
  const index = fs.readFileSync(pub('index.html'), 'utf8').replace(/"app\.js\?v=[0-9a-f]+"/, '"app.js?v=' + ver['app.js'] + '"');
  fs.writeFileSync(pub('index.html'), index);
  const shell = ['./', 'manifest.webmanifest', 'icons/favicon-64.png', 'icons/icon-192.png', 'icons/icon-512.png'].concat(['app.js', 'app-api.js', 'password-eye.js', 'password-eye.css', 'fonts/figtree.css', 'vendor/jspdf.umd.min.js'].map(f => f + '?v=' + ver[f]));
  const h = sum(Buffer.from(index + JSON.stringify(ver)));
  fs.writeFileSync(pub('sw.js'), rd('sw.js').replace('__VERSION__', h).replace("'__SHELL__'", shell.map(x => JSON.stringify(x)).join(', ')));
}
// Symbol: Logo als Hintergrund, Terminbalken davor (erzeugt mit scripts/make-icons.py aus src/icons/logo-hbc.png)

// 2) Claude-Version (Artifact mit gemeinsamer Claude-Datenbank)
fs.mkdirSync(path.join(root, 'claude'), { recursive: true });
fs.writeFileSync(path.join(root, 'claude', 'terminplaner-claude.html'), head + '\n' + body + '\n<script>\n' + app + '</script>\n');
console.log('Gebaut: public/ und claude/');
