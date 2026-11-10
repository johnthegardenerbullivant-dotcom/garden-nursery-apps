// Nursery Management — Minimal Service Worker
// Satisfies PWA install requirements; all network requests pass through (no stale-data risk).

const CACHE_NAME = 'nursery-mgmt-v1';

const PRECACHE_ASSETS = [
  '/',
  '/index.html',
  '/styles.css',
  '/icons/icon-192.png',
  '/icons/icon-512.png'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(PRECACHE_ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// ---------- Fetch ----------
// The app's own files: network first, cache as the fallback, so a deploy shows
// up at once and the last version loaded still opens with no signal.
//
// The libraries it imports from CDNs are cached here too (2026-11). They used
// to be left to the browser's ordinary cache, which is free to drop them, and
// without the Firebase SDK the app cannot start at all, offline cache or not.
//   • gstatic's Firebase files carry their version in the URL and never
//     change, so the cached copy is used without asking the network.
//   • the others (image compression, QR, Quill) are served from cache and
//     refreshed in the background.
const CDN_PINNED   = ['https://www.gstatic.com/firebasejs/'];
const CDN_FLOATING = ['https://cdn.jsdelivr.net/', 'https://cdn.quilljs.com/'];

function fetchAndStore(request) {
  return fetch(request).then(response => {
    if (response.ok) {
      const clone = response.clone();
      caches.open(CACHE_NAME).then(cache => cache.put(request, clone));
    }
    return response;
  });
}

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  const href = event.request.url;

  if (CDN_PINNED.some(p => href.startsWith(p))) {
    event.respondWith(
      caches.match(event.request).then(hit => hit || fetchAndStore(event.request))
    );
    return;
  }

  if (CDN_FLOATING.some(p => href.startsWith(p))) {
    event.respondWith(
      caches.match(event.request).then(hit => {
        const fresh = fetchAndStore(event.request);
        if (!hit) return fresh;
        fresh.catch(() => {});   // offline: the cached copy is the answer
        return hit;
      })
    );
    return;
  }

  // Everything else cross-origin (Firestore, Storage, sign-in) goes straight through.
  if (new URL(href).origin !== self.location.origin) return;

  event.respondWith(
    fetchAndStore(event.request).catch(() => caches.match(event.request))
  );
});
