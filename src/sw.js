const CACHE_VERSION = 'prawko-v104';
const APP_SHELL_CACHE = CACHE_VERSION + '-shell';
const DATA_CACHE = CACHE_VERSION + '-data';
const MEDIA_CACHE = CACHE_VERSION + '-media';
const OFFLINE_MEDIA_CACHE = 'prawko-offline-media-v1';

const APP_SHELL = [
  './',
  './index.html',
  './css/style.css',
  './js/app.js',
  './js/data.js',
  './js/exam.js',
  './js/learn.js',
  './js/ui.js',
  './js/timer.js',
  './js/stats.js',
  './js/profiles.js',
  './js/i18n.js',
  './js/offline.js',
  './js/zip.js',
  './js/scale.js',
  './js/scale-boot.js',
  './js/fit-text.js',
  './data/meta.json',
  './data/translations_en.json',
  './data/translations_de.json',
  './data/translations_uk.json',
  './manifest.json',
  './icons/cursor-black.png',
  './icons/cursor-white.png',
  './icons/cursor-pointer-black.png',
  './icons/cursor-pointer-white.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(APP_SHELL_CACHE).then((cache) => cache.addAll(APP_SHELL))
  );
});

let activatedAt = Date.now();

let offlineMediaUrls = new Set();
let offlineMediaByTail = new Map();

function mediaPathTail(href) {
  try {
    const u = new URL(href, self.location.href);
    const m = u.pathname.match(/\/(vid|img)\/[^/]+$/i);
    return m ? m[0].toLowerCase() : '';
  } catch {
    return '';
  }
}

function remoteMediaCached(href) {
  if (offlineMediaUrls.has(href)) return true;
  try {
    const u = new URL(href);
    if (offlineMediaUrls.has(u.origin + u.pathname)) return true;
  } catch { /* ignore */ }
  const tail = mediaPathTail(href);
  return Boolean(tail && offlineMediaByTail.has(tail));
}

async function rebuildOfflineMediaIndex() {
  const cache = await caches.open(OFFLINE_MEDIA_CACHE);
  const keys = await cache.keys();
  const urls = new Set();
  const byTail = new Map();
  for (const req of keys) {
    urls.add(req.url);
    try {
      const u = new URL(req.url);
      urls.add(u.origin + u.pathname);
    } catch { /* ignore bad cache keys */ }
    const tail = mediaPathTail(req.url);
    if (tail && !byTail.has(tail)) byTail.set(tail, req.url);
  }
  offlineMediaUrls = urls;
  offlineMediaByTail = byTail;
}

self.addEventListener('activate', (event) => {
  activatedAt = Date.now();
  const currentCaches = [APP_SHELL_CACHE, DATA_CACHE, MEDIA_CACHE, OFFLINE_MEDIA_CACHE];
  event.waitUntil((async () => {
    await rebuildOfflineMediaIndex();
    const names = await caches.keys();
    await Promise.all(
      names
        .filter((name) => name.startsWith('prawko-') && !currentCaches.includes(name))
        .map((name) => caches.delete(name))
    );
    await self.clients.claim();
  })());
});

async function matchOfflineMedia(request) {
  const cache = await caches.open(OFFLINE_MEDIA_CACHE);
  const url = typeof request === 'string' ? request : request.url;
  const opts = { ignoreSearch: true, ignoreVary: true };
  const direct = (await cache.match(request, opts))
    || (await cache.match(url, opts))
    || (await cache.match(new Request(url, { mode: 'cors' }), opts))
    || (await cache.match(new Request(url, { mode: 'no-cors' }), opts))
    || (await cache.match(new Request(url, { mode: 'same-origin' }), opts));
  if (direct) return direct;
  const tail = mediaPathTail(url);
  const stored = tail ? offlineMediaByTail.get(tail) : '';
  if (!stored) return null;
  return (await cache.match(stored, opts))
    || (await cache.match(new Request(stored, { mode: 'cors' }), opts))
    || (await cache.match(new Request(stored, { mode: 'same-origin' }), opts));
}

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  if (event.request.method !== 'GET') return;
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return;
  if (url.pathname.endsWith('/sw.js')) return;
  if (url.pathname.endsWith('/local.json')) return;
  // CDN media: intercept only when the offline pack has this file (by URL
  // or by /vid|/img tail). Pack keys may be localhost media/… while <video>
  // uses the B2 URL — still serve the cached blob, do not hit Backblaze.
  if (url.origin !== self.location.origin) {
    if (!/\.(mp4|webm|webp|jpg|jpeg|png|gif)(\?|$)/i.test(url.pathname)) return;
    const indexReady = offlineMediaUrls.size > 0 || offlineMediaByTail.size > 0;
    if (indexReady && !remoteMediaCached(url.href)) return;
    event.respondWith((async () => {
      if (!indexReady) await rebuildOfflineMediaIndex();
      if (!remoteMediaCached(url.href)) return fetch(event.request);
      const cached = await matchOfflineMedia(event.request);
      if (cached) return cached;
      return fetch(event.request);
    })());
    return;
  }

  // Category JSON & translation files — stale-while-revalidate
  if (url.pathname.match(/\/data\/(?!meta\.json).+\.json$/)) {
    event.respondWith(
      caches.open(DATA_CACHE).then((cache) =>
        cache.match(event.request).then((cached) => {
          const fetched = fetch(event.request).then(async (response) => {
            if (response.ok) {
              if (cached) {
                const [oldText, newText] = await Promise.all([
                  cached.clone().text(),
                  response.clone().text()
                ]);
                if (oldText !== newText) {
                  notifyClients({ type: 'DATA_UPDATED' });
                }
              }
              safeCachePut(cache, event.request, response.clone());
            }
            return response;
          }).catch(() => cached);
          return cached || fetched;
        })
      )
    );
    return;
  }

  // Local /media/ — same as CDN: intercept only when the offline pack has
  // this file. Wrapping a cache miss with fetch(event.request) shows up as
  // two GETs in DevTools (page + sw.js) even though it is one origin hit.
  if (url.pathname.match(/\/media\//)) {
    if (!remoteMediaCached(url.href)) return;
    event.respondWith((async () => {
      const cached = await matchOfflineMedia(event.request);
      if (cached) return cached;
      const mediaCache = await caches.open(MEDIA_CACHE);
      const fromMedia = await mediaCache.match(event.request);
      if (fromMedia) return fromMedia;
      return fetch(event.request);
    })());
    return;
  }

  if (url.pathname.includes('/icons/')) {
    event.respondWith(
      caches.open(APP_SHELL_CACHE).then((cache) =>
        cache.match(event.request).then((cached) => {
          if (cached) return cached;
          return fetch(event.request).then((response) => {
            if (response.ok) safeCachePut(cache, event.request, response.clone());
            return response;
          });
        })
      )
    );
    return;
  }

  // App shell — network first so a refresh actually picks up new HTML/JS/CSS.
  // Cache is the offline fallback, not the thing that hides updates.
  event.respondWith(
    fetch(event.request).then((response) => {
      if (response.ok) {
        const copy = response.clone();
        event.waitUntil(
          caches.open(APP_SHELL_CACHE).then((cache) => safeCachePut(cache, event.request, copy))
        );
      }
      return response;
    }).catch(() =>
      caches.open(APP_SHELL_CACHE).then((cache) =>
        cache.match(event.request).then((cached) => cached || cache.match('./index.html') || cache.match('./'))
      )
    )
  );
});

self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
  if (event.data?.type === 'OFFLINE_MEDIA_UPDATED') {
    event.waitUntil(rebuildOfflineMediaIndex());
  }
});

const lastNotifyAt = Object.create(null);

function notifyClients(message) {
  const prev = lastNotifyAt[message.type] || 0;
  if (Date.now() - prev < 10 * 1000) return;
  lastNotifyAt[message.type] = Date.now();
  self.clients.matchAll({ type: 'window' }).then((clients) => {
    clients.forEach((client) => client.postMessage(message));
  });
}

function safeCachePut(cache, request, response) {
  const requestUrl = new URL(request.url);
  if (requestUrl.protocol !== 'http:' && requestUrl.protocol !== 'https:') {
    return Promise.resolve();
  }
  return cache.put(request, response).catch(() => Promise.resolve());
}
