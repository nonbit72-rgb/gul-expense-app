/* ============================================================
   SERVICE WORKER — Expense Manager PWA
   - Cache-first strategy for app shell files
   - Versioned cache: old caches are deleted on activate
   - Serves the app fully offline
============================================================ */

const CACHE_VERSION = 'expense-manager-v1';

// Files to cache on install (app shell)
const CACHE_FILES = [
  './index.html',
  './style.css',
  './script.js',
  './manifest.json'
];

// ---- INSTALL: Cache all app shell files ----
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION).then((cache) => {
      return cache.addAll(CACHE_FILES);
    }).then(() => {
      // Immediately activate new service worker
      return self.skipWaiting();
    })
  );
});

// ---- ACTIVATE: Delete old cache versions ----
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames
          .filter((name) => name !== CACHE_VERSION)
          .map((name) => caches.delete(name))
      );
    }).then(() => {
      // Take control of all open clients immediately
      return self.clients.claim();
    })
  );
});

// ---- FETCH: Cache-first, fallback to network ----
self.addEventListener('fetch', (event) => {
  // Only handle same-origin GET requests
  if (event.request.method !== 'GET') return;

  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      // Return cached version if available
      if (cachedResponse) {
        return cachedResponse;
      }
      // Otherwise fetch from network and cache the result
      return fetch(event.request).then((networkResponse) => {
        // Cache valid responses for future offline use
        if (networkResponse && networkResponse.status === 200) {
          const responseClone = networkResponse.clone();
          caches.open(CACHE_VERSION).then((cache) => {
            cache.put(event.request, responseClone);
          });
        }
        return networkResponse;
      }).catch(() => {
        // If both cache and network fail, return the cached index.html
        // (handles navigation requests when fully offline)
        if (event.request.mode === 'navigate') {
          return caches.match('./index.html');
        }
      });
    })
  );
});
