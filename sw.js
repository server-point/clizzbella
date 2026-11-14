const VERSION = 'clz-v1';               // bump on every deploy that changes cached assets
const SHELL = `${VERSION}-shell`;
const RUNTIME = `${VERSION}-runtime`;
const SHELL_ASSETS = ['/', '/manifest.webmanifest', '/icons/icon-192.png', '/icons/icon-512.png'];
const CORS_HOSTS = ['res.cloudinary.com', 'fonts.googleapis.com', 'fonts.gstatic.com', 'cdnjs.cloudflare.com'];
const MAX_RUNTIME_ENTRIES = 80;

self.addEventListener('install', e => {
  e.waitUntil(caches.open(SHELL).then(c => c.addAll(SHELL_ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => !k.startsWith(VERSION)).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

async function trim(cacheName, max) {
  const cache = await caches.open(cacheName);
  const keys = await cache.keys();
  if (keys.length > max) await Promise.all(keys.slice(0, keys.length - max).map(k => cache.delete(k)));
}

async function staleWhileRevalidate(req, cacheName, fetchReq) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(req);
  const network = fetch(fetchReq || req)
    .then(res => { if (res.ok) { cache.put(req, res.clone()).then(() => trim(cacheName, MAX_RUNTIME_ENTRIES)); } return res; })
    .catch(() => cached);
  return cached || network;
}

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // Page navigations: network first, fall back to cached homepage when offline
  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req)
        .then(res => {
          if (res.ok && !res.redirected && url.pathname === '/') {
            const copy = res.clone();
            caches.open(SHELL).then(c => c.put('/', copy));
          }
          return res;
        })
        .catch(() => caches.match('/'))
    );
    return;
  }

  // Same-origin static files
  if (url.origin === location.origin) {
    e.respondWith(staleWhileRevalidate(req, RUNTIME));
    return;
  }

  // Approved third-party hosts. Re-fetched with CORS to avoid huge "opaque" cache entries.
  if (CORS_HOSTS.includes(url.hostname)) {
    e.respondWith(staleWhileRevalidate(req.url, RUNTIME, new Request(req.url, { mode: 'cors' })));
  }
  // Everything else (YouTube, Google Maps, wa.me) goes straight to the network
});
