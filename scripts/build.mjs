// Baut aus src/ die Webseiten für Vercel (public/), die Claude-Version (claude/) und die Server-Logik (lib/logic.cjs)
import './gen-logic.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const rd = f => fs.readFileSync(path.join(root, 'src', f), 'utf8');
const head = rd('head.html'), body = rd('body.html');
const js = ['logic.js', 'people.js', 'ui.js', 'views.js', 'gantt-ext.js', 'tasks.js', 'org.js', 'touch-dnd.js', 'assignee-picker.js', 'pdf.js'].map(rd).join('\n');
const app = "(function(){\n'use strict';\n" + js + "\nboot();\n})();\n";

// 1) Website für Vercel: ohne externe Schriften und CDNs (DSGVO), PDF-Baustein lokal
fs.mkdirSync(path.join(root, 'public', 'vendor'), { recursive: true });
const webHead = head
  .replace(/<link[^>]*fonts\.g[^>]*>\n?/g, '')
  .replace('<title>Gantt Terminplaner</title>', '<title>Terminplaner</title>\n<link rel="stylesheet" href="password-eye.css">\n<link rel="icon" href="favicon.svg">\n' +
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
// App (PWA): Manifest, Symbole, Service Worker (Version = Prüfsumme der Seite, damit Updates ankommen)
fs.mkdirSync(path.join(root, 'public', 'icons'), { recursive: true });
for (const f of fs.readdirSync(path.join(root, 'src', 'icons'))) fs.copyFileSync(path.join(root, 'src', 'icons', f), path.join(root, 'public', 'icons', f));
fs.copyFileSync(path.join(root, 'src', 'manifest.webmanifest'), path.join(root, 'public', 'manifest.webmanifest'));
{
  const { createHash } = await import('node:crypto');
  const h = createHash('sha256').update(fs.readFileSync(path.join(root, 'public', 'index.html'))).update(fs.readFileSync(path.join(root, 'public', 'app.js'))).update(fs.readFileSync(path.join(root, 'src', 'server-api.js'))).update(rd('password-eye.js')).update(rd('password-eye.css')).digest('hex').slice(0, 10);
  fs.writeFileSync(path.join(root, 'public', 'sw.js'), rd('sw.js').replace('__VERSION__', h));
}
fs.copyFileSync(path.join(root, 'node_modules', 'jspdf', 'dist', 'jspdf.umd.min.js'), path.join(root, 'public', 'vendor', 'jspdf.umd.min.js'));
fs.writeFileSync(path.join(root, 'public', 'favicon.svg'), '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="6" fill="#26664b"/><rect x="6" y="8" width="12" height="4" rx="1.5" fill="#fff"/><rect x="11" y="14" width="14" height="4" rx="1.5" fill="#fff"/><rect x="9" y="20" width="10" height="4" rx="1.5" fill="#fff"/></svg>\n');

// 2) Claude-Version (Artifact mit gemeinsamer Claude-Datenbank)
fs.mkdirSync(path.join(root, 'claude'), { recursive: true });
fs.writeFileSync(path.join(root, 'claude', 'terminplaner-claude.html'), head + '\n' + body + '\n<script>\n' + app + '</script>\n');
console.log('Gebaut: public/ und claude/');
