/**
 * OpenSun AR — sw.js
 * Service Worker for offline caching (PWA Phase 5).
 *
 * Strategy: Cache-first for all app assets (including the local SunCalc copy).
 */

'use strict';

const CACHE_NAME = 'opensun-ar-v1';

// App-shell assets to cache on install
const PRECACHE_URLS = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './suncalc.js',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png',
];

/* ────────────────────────────────────────────────
   Install — pre-cache app shell
──────────────────────────────────────────────── */
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(PRECACHE_URLS))
  );
  // Activate immediately (don't wait for old SW to be released)
  self.skipWaiting();
});

/* ────────────────────────────────────────────────
   Activate — clean up old caches
──────────────────────────────────────────────── */
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys
          .filter(k => k !== CACHE_NAME && k.startsWith('opensun-ar-'))
          .map(k => caches.delete(k))
      )
    )
  );
  self.clients.claim();
});

/* ────────────────────────────────────────────────
   Fetch — serve from cache, fall back to network
──────────────────────────────────────────────── */
self.addEventListener('fetch', event => {
  const { request } = event;

  // Only handle GET requests
  if (request.method !== 'GET') return;

  // Cache-first with network fallback for all assets
  event.respondWith(cacheFirstWithNetwork(request));
});

/** Try the cache first; if missing, fetch from network and cache the result. */
async function cacheFirstWithNetwork(request) {
  const cached = await caches.match(request);
  if (cached) return cached;

  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(CACHE_NAME);
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    // If offline and not in cache, return the app shell for navigation requests
    if (request.mode === 'navigate') {
      const fallback = await caches.match('./index.html');
      if (fallback) return fallback;
    }
    return new Response('Offline', { status: 503, statusText: 'Service Unavailable' });
  }
}
