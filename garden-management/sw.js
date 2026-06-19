// Garden Management — Minimal Service Worker
// Purpose: satisfies PWA install requirements so Chrome treats this as an
// installable app (enabling single-instance / "return to existing tab" behaviour).
// All network requests pass straight through — no caching that could cause
// stale data issues with the Firebase backend.

const CACHE_NAME = 'garden-mgmt-v1';

// Assets to pre-cache so the app shell loads instantly (and offline splash works)
const PRECACHE_ASSETS = [
  '/',
  '/index.html',
  '/styles.css',
  '/icons/icon-192.png',
  '/icons/icon-512.png'
];

// ---------- Install ----------
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(PRECACHE_ASSETS))
  );
  // Activate immediately rather than waiting for existing tabs to close
  self.skipWaiting();
});

// ---------- Activate ----------
self.addEventListener('activate', event => {
  // Remove any old caches from previous versions
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  );
  // Take control of all open clients immediately
  self.clients.claim();
});

// ---------- Fetch ----------
// Strategy: Network-first for everything.
// Falls back to cache only for the app shell (so a splash renders when offline).
self.addEventListener('fetch', event => {
  // Only intercept same-origin GET requests; let Firebase/Google APIs go straight through
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;

  event.respondWith(
    fetch(event.request)
      .then(response => {
        // Update the cache with the fresh response
        const clone = response.clone();
        caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
        return response;
      })
      .catch(() => caches.match(event.request))
  );
});
