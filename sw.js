/* Service worker for Forge PvP Sim.
   - NETWORK-FIRST for page navigations: when online you ALWAYS get the newest
     uploaded app (no more stale-shell double reloads); the fetched copy is
     cached so the app still opens fully offline.
   - Precaches the app shell on install for offline-from-first-visit.
   - Cache-first runtime caching for the pinned Tesseract.js CDN assets (script,
     worker, WASM core, English traineddata), so screenshot OCR works offline
     after the first online run.
   Bump CACHE_VERSION on any release to invalidate old caches. */
'use strict';

const CACHE_VERSION = 'v7';
const SHELL_CACHE = 'forge-pvp-shell-' + CACHE_VERSION;
const RUNTIME_CACHE = 'forge-pvp-runtime-' + CACHE_VERSION;

// App shell — everything the sim needs with no connection.
const SHELL_ASSETS = [
  'index.html',
  'manifest.webmanifest',
  'icon-180.png',
  'icon-192.png',
  'icon-512.png',
];

// Hosts whose responses get cache-first runtime caching (pinned Tesseract
// script/worker/core from jsDelivr + the English traineddata).
function isTesseractAsset(url) {
  return (url.hostname === 'cdn.jsdelivr.net' && url.pathname.includes('tesseract')) ||
         url.hostname === 'tessdata.projectnaptha.com';
}

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(SHELL_CACHE)
      .then(cache => cache.addAll(SHELL_ASSETS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys => Promise.all(
      keys.filter(k => k !== SHELL_CACHE && k !== RUNTIME_CACHE)
          .map(k => caches.delete(k))
    )).then(() => self.clients.claim())
  );
});

async function cacheFirst(cacheName, request) {
  const cached = await caches.match(request, { ignoreVary: true });
  if (cached) return cached;
  const response = await fetch(request);
  // Cache good responses (including opaque cross-origin ones) for next time.
  if (response && (response.ok || response.type === 'opaque')) {
    const cache = await caches.open(cacheName);
    cache.put(request, response.clone());
  }
  return response;
}

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);

  if (isTesseractAsset(url)) {                 // OCR library: cache-first
    event.respondWith(cacheFirst(RUNTIME_CACHE, request));
    return;
  }
  if (url.origin === location.origin) {
    if (request.mode === 'navigate') {
      // NETWORK-FIRST: serve the freshest app when online (and refresh the
      // offline copy); fall back to the cached shell when offline.
      event.respondWith(
        fetch(request).then(response => {
          if (response && response.ok) {
            const copy = response.clone();
            caches.open(SHELL_CACHE).then(cache => cache.put('index.html', copy));
          }
          return response;
        }).catch(() =>
          caches.match('index.html').then(r => r || caches.match(request))
        )
      );
    } else {
      event.respondWith(cacheFirst(SHELL_CACHE, request));   // icons, manifest
    }
  }
  // anything else: default network behaviour
});
