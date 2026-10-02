// Offline cache for the app's own files. Bump VERSION when any app file changes.
// Only this site's files are cached: Google sign-in and Drive traffic always goes straight to the network.
const VERSION = 'fin-v11';
const FILES = ['./', './index.html', './app.js', './parser.js', './model.js', './xlsx.js', './cloud.js', './config.js', './logo-icon.png', './favicon-32.png', './manifest.webmanifest',
  './pdf.min.mjs', './pdf.worker.min.mjs', './icon-192.png', './icon-512.png', './apple-touch-icon.png'];
self.addEventListener('install', (e) => { e.waitUntil(caches.open(VERSION).then((c) => c.addAll(FILES)).then(() => self.skipWaiting())); });
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== VERSION).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== self.location.origin) return; // never touch Google traffic
  e.respondWith(caches.open(VERSION).then(async (c) => {
    const hit = await c.match(e.request, { ignoreSearch: true });
    const net = fetch(e.request).then((r) => { if (r.ok) c.put(e.request, r.clone()); return r; }).catch(() => hit);
    return hit || net;
  }));
});
