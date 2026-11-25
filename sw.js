// Service Worker: macht die App offline nutzbar.
// Bei jeder Änderung an den Dateien VERSION erhöhen, damit Geräte die neue Version laden.
const VERSION = 'v1';
const CACHE = 'lehrbegleiter-' + VERSION;
const FILES = ['./', './index.html', './styles.css', './app.js', './manifest.webmanifest',
  './icons/icon.svg', './icons/icon-192.png', './icons/icon-512.png', './icons/apple-touch-icon.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  // Nur eigene alte Caches löschen (der Lernbegleiter liegt auf derselben Domain)
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k.startsWith('lehrbegleiter-') && k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});
// Erst Netz (damit Updates sofort ankommen), offline aus dem Cache.
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET' || new URL(e.request.url).origin !== location.origin) return;
  e.respondWith(
    fetch(e.request)
      .then(res => { const copy = res.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); return res; })
      .catch(() => caches.match(e.request, { ignoreSearch: true }).then(r => r || caches.match('./index.html')))
  );
});
