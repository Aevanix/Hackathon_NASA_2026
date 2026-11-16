const CACHE = 'astra-shell-v17';
const SHELL = ['/', '/styles.css?v=11', '/operations.css?v=1', '/polish.css?v=1', '/upgrade.css?v=1', '/night.css?v=1', '/medical.css?v=2', '/app.js?v=17', '/modules/catalog.js?v=4', '/modules/operations.js?v=5', '/modules/medical-data.js?v=1', '/modules/polish.js?v=2', '/modules/upgrade.js?v=1', '/modules/login-effects.js?v=1', '/astra-mark.png', '/manifest.webmanifest'];
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
