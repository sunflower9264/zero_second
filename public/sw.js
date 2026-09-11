// Hand-written service worker: no workbox, no build step, no npm dependency. Its whole job is to
// keep the game launchable from the home screen with no network.
//
// Bump CACHE when the shell files change. Hashed /assets/ files are immutable, so they are cached
// permanently under the current name and dropped when the name moves on.
const CACHE = 'zero-second-v1';
const SHELL = ['/', '/index.html', '/favicon.svg', '/apple-touch-icon.png', '/icon-192.png', '/icon-512.png', '/manifest.webmanifest'];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(key => key !== CACHE).map(key => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

function cacheFirst(request) {
  return caches.match(request).then(cached => cached || fetch(request).then(response => {
    if (response.ok) { const copy = response.clone(); caches.open(CACHE).then(cache => cache.put(request, copy)); }
    return response;
  }));
}

function networkFirst(request) {
  return fetch(request).then(response => {
    if (response.ok) { const copy = response.clone(); caches.open(CACHE).then(cache => cache.put(request, copy)); }
    return response;
  }).catch(() => caches.match(request).then(cached => cached || caches.match('/index.html')));
}

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  // Telemetry must never be served from cache, and a failed beacon should stay failed.
  if (url.pathname.startsWith('/api/')) return;
  event.respondWith(url.pathname.startsWith('/assets/') ? cacheFirst(request) : networkFirst(request));
});
