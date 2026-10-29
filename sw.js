'use strict';

const APP_VERSION = '0.5.0-rc.8';
const SCOPE_KEY = encodeURIComponent(new URL(self.registration.scope).pathname || '/');
const CACHE_PREFIX = `x-panorama:${SCOPE_KEY}:`;
const CACHE_NAME = `${CACHE_PREFIX}${APP_VERSION}`;
const LEGACY_CACHE_PATTERN = /^x-panorama-v\d+\.\d+\.\d+(?:-[0-9A-Za-z.]+)?$/;
const OFFLINE_PAGE = './index.html';
const NAVIGATION_NETWORK_TIMEOUT_MS = 2500;
const APP_SHELL = [
  './app.js?v=0.5.0-rc.8',
  './core.js?v=0.5.0-rc.8',
  './diagnostics.js?v=0.5.0-rc.8',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './image-worker.js?v=0.5.0-rc.8',
  './index.html',
  './manifest.webmanifest?v=0.5.0-rc.8',
  './styles.css?v=0.5.0-rc.8',
  './zip.js?v=0.5.0-rc.8'
];
const STATIC_ASSET_URLS = new Set(APP_SHELL.map((path) => new URL(path, self.location.href).href));

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(APP_SHELL))
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => (key.startsWith(CACHE_PREFIX) || LEGACY_CACHE_PATTERN.test(key)) && key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});

async function navigationNetworkFirst(request) {
  const networkRequest = fetch(request);
  let timeoutId;
  const timeoutMarker = {};
  try {
    const response = await Promise.race([
      networkRequest,
      new Promise((resolve) => {
        timeoutId = setTimeout(() => resolve(timeoutMarker), NAVIGATION_NETWORK_TIMEOUT_MS);
      })
    ]);
    if (response !== timeoutMarker) return response;
    const cache = await caches.open(CACHE_NAME);
    const cached = await cache.match(OFFLINE_PAGE);
    // On a first visit there may be no shell yet; keep waiting for the real
    // response instead of resolving respondWith() with an empty value.
    if (cached) return cached;
    return await networkRequest;
  } catch (error) {
    const cache = await caches.open(CACHE_NAME);
    const cached = await cache.match(OFFLINE_PAGE);
    if (cached) return cached;
    throw error;
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}

async function cacheFirst(request) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response && response.ok) {
    cache.put(request, response.clone()).catch(() => {});
  }
  return response;
}

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;

  if (event.request.mode === 'navigate') {
    event.respondWith(navigationNetworkFirst(event.request));
    return;
  }

  if (!STATIC_ASSET_URLS.has(url.href)) return;
  event.respondWith(cacheFirst(event.request));
});
