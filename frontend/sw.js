const CACHE = 'astra-shell-v10';
const SHELL = ['/', '/styles.css?v=10', '/operations.css?v=1', '/polish.css?v=1', '/upgrade.css?v=1', '/app.js?v=10', '/modules/catalog.js?v=4', '/modules/operations.js?v=5', '/modules/polish.js?v=1', '/modules/upgrade.js?v=1', '/mark.svg', '/manifest.webmanifest'];
self.addEventListener('install', (event) => event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting())));
self.addEventListener('activate', (event) => event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((key) => key.startsWith('astra-shell-') && key !== CACHE).map((key) => caches.delete(key)))).then(() => self.clients.claim())));
self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET' || new URL(request.url).origin !== self.location.origin) return;
  if (new URL(request.url).pathname.startsWith('/api/')) return;
  event.respondWith(fetch(request).then((response) => {
    if (response.ok) { const copy = response.clone(); caches.open(CACHE).then((cache) => cache.put(request, copy)); }
    return response;
  }).catch(async () => (await caches.match(request)) || caches.match('/')));
});
