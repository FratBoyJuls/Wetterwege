/* Wetterwege: App-Hülle offline verfügbar halten. Wetter, Routing und Karten kommen immer frisch aus dem Netz. */
const CACHE = 'wetterwege-0.3.0';
const SHELL = ['./', 'index.html', 'manifest.webmanifest', 'icon-180.png', 'icon-192.png', 'icon-512.png'];
self.addEventListener('install', (e) => { e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return; // fremde Dienste nie zwischenspeichern
  if (req.mode === 'navigate') {
    // Erst Netz (für Updates), sonst gespeicherte Version
    e.respondWith(fetch(req).then((r) => { const c = r.clone(); caches.open(CACHE).then((cc) => cc.put('index.html', c)); return r; }).catch(() => caches.match('index.html')));
    return;
  }
  e.respondWith(caches.match(req).then((hit) => hit || fetch(req)));
});
