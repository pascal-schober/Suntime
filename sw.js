/**
 * OpenSun AR — sw.js
 * Service Worker for offline caching (PWA Phase 5).
 *
 * Strategy: Cache-first for app shell assets; network-first for SunCalc CDN.
 */

'use strict';

const CACHE_NAME    = 'opensun-ar-v1';
const CACHE_TIMEOUT = 4000; // ms before falling back to cache for network requests

// App-shell assets to cache on install
const PRECACHE_URLS = [
  '/',
  '/index.html',
  '/style.css',
  '/app.js',
  '/manifest.json',
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
          .filter(k => k !== CACHE_NAME)
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

  // For the SunCalc CDN script: network-first with cache fallback
  if (request.url.includes('cdnjs.cloudflare.com')) {
    event.respondWith(networkFirstWithCache(request));
    return;
  }

  // For everything else: cache-first with network fallback
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
    // If offline and not in cache, return a minimal offline page for navigation requests
    if (request.mode === 'navigate') {
      const fallback = await caches.match('/index.html');
      if (fallback) return fallback;
    }
    return new Response('Offline', { status: 503, statusText: 'Service Unavailable' });
  }
}

/** Try the network first (with timeout); fall back to cache. */
async function networkFirstWithCache(request) {
  const timeoutPromise = new Promise((_, reject) =>
    setTimeout(() => reject(new Error('timeout')), CACHE_TIMEOUT)
  );

  try {
    const response = await Promise.race([fetch(request), timeoutPromise]);
    if (response.ok) {
      const cache = await caches.open(CACHE_NAME);
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    const cached = await caches.match(request);
    if (cached) return cached;
    return new Response('', { status: 503, statusText: 'Service Unavailable' });
  }
}
