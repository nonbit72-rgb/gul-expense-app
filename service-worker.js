/* ============================================================
   SERVICE WORKER — Expense Manager PWA
   - Cache-first strategy for all app shell files
   - Versioned cache: old caches deleted on activate
   - Works on GitHub Pages (subdirectory) and root hosting
============================================================ */

const CACHE_VERSION = 'expense-manager-v2';

// All files to cache on install (relative to SW scope)
const CACHE_FILES = [
  './',
  './index.html',
  './style.css',
  './script.js',
  './manifest.json',
  './icon-192.png',
  './icon-512.png'
];

// ---- INSTALL: Pre-cache all app shell files ----
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION)
      .then((cache) => cache.addAll(CACHE_FILES))
      .then(() => self.skipWaiting())
  );
});

// ---- ACTIVATE: Delete all old cache versions ----
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((names) => Promise.all(
        names.filter((n) => n !== CACHE_VERSION).map((n) => caches.delete(n))
      ))
      .then(() => self.clients.claim())
  );
});

// ---- FETCH: Cache-first, network fallback ----
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;

  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;

      return fetch(event.request).then((response) => {
        if (response && response.status === 200 && response.type !== 'opaque') {
          const clone = response.clone();
          caches.open(CACHE_VERSION).then((cache) => cache.put(event.request, clone));
        }
        return response;
      }).catch(() => {
        // Offline fallback: return cached index.html for navigation requests
        if (event.request.mode === 'navigate') {
          return caches.match('./index.html');
        }
      });
    })
  );
});
