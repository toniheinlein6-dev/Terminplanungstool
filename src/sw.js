// Service Worker: App-Hülle zwischenspeichern, damit die installierte App schnell und auch ohne Netz startet.
// Daten (/api/) laufen immer über das Netz. Seiten zuerst aus dem Netz, ohne Netz aus dem Speicher.
// Programmdateien tragen ihre Prüfsumme in der Adresse (?v=…): eine neue Version hat neue Adressen,
// alte Dateien werden nie mit neuen Seiten gemischt. Eine neue Version übernimmt sofort (skipWaiting),
// die Seite meldet sich dann mit „Neue Version“ und lädt neu (siehe initUpdates in shell.js).
const CACHE = 'terminplaner-__VERSION__';
const SHELL = ['__SHELL__'];
self.addEventListener('install', e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('message', e => { if (e.data === 'version' && e.ports[0]) e.ports[0].postMessage(CACHE); });
self.addEventListener('fetch', e => {
  const req = e.request, url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== location.origin || url.pathname.startsWith('/api/') || url.pathname.endsWith('/sw.js')) return;
  if (req.mode === 'navigate') {
    // nur die Startseite als App-Hülle merken (nicht Verwaltung, Einrichtung o. Ä.)
    const shell = url.pathname === '/' || url.pathname.endsWith('/index.html');
    e.respondWith(fetch(req, { cache: 'no-store' }).then(r => { if (shell && r.ok) { const c = r.clone(); caches.open(CACHE).then(x => x.put('./', c)); } return r; }).catch(() => shell ? caches.match('./') : Response.error()));
    return;
  }
  // Versionierte Dateien ändern sich nie: zuerst aus dem Speicher. Alles andere: Netz, ohne Netz aus dem Speicher.
  if (url.searchParams.has('v')) {
    e.respondWith(caches.match(req).then(hit => hit || fetch(req).then(r => { if (r.ok) { const c = r.clone(); caches.open(CACHE).then(x => x.put(req, c)); } return r; })));
    return;
  }
  e.respondWith(fetch(req).then(r => { if (r.ok) { const c = r.clone(); caches.open(CACHE).then(x => x.put(req, c)); } return r; }).catch(() => caches.match(req)));
});
