const CACHE_VERSION = 'prawko-v70';
const APP_SHELL_CACHE = CACHE_VERSION + '-shell';
const DATA_CACHE = CACHE_VERSION + '-data';
const MEDIA_CACHE = CACHE_VERSION + '-media';
const OFFLINE_MEDIA_CACHE = 'prawko-offline-media-v1';
const MEDIA_CACHE_LIMIT = 500;

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
  './js/scale.js',
  './js/scale-boot.js',
  './data/meta.json',
  './data/translations_en.json',
  './data/translations_de.json',
  './data/translations_uk.json',
  './manifest.json'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(APP_SHELL_CACHE).then((cache) => cache.addAll(APP_SHELL))
  );
});

let activatedAt = Date.now();

self.addEventListener('activate', (event) => {
  activatedAt = Date.now();
  const currentCaches = [APP_SHELL_CACHE, DATA_CACHE, MEDIA_CACHE, OFFLINE_MEDIA_CACHE];
  event.waitUntil(
    caches.keys().then((names) =>
      Promise.all(
        names
          .filter((name) => name.startsWith('prawko-') && !currentCaches.includes(name))
          .map((name) => caches.delete(name))
      )
    )
  );
  self.clients.claim();
});

async function matchOfflineMedia(request) {
  const cache = await caches.open(OFFLINE_MEDIA_CACHE);
  const url = typeof request === 'string' ? request : request.url;
  return (await cache.match(request))
    || (await cache.match(url))
    || (await cache.match(new Request(url, { mode: 'cors' })))
    || (await cache.match(new Request(url, { mode: 'no-cors' })))
    || (await cache.match(new Request(url, { mode: 'same-origin' })));
}

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  if (event.request.method !== 'GET') return;
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return;
  if (url.pathname.endsWith('/sw.js')) return;
  if (url.pathname.endsWith('/local.json')) return;
  // CDN media: serve the offline pack when present, otherwise let the
  // browser talk to B2 itself so Range/CORS work on GitHub Pages.
  if (url.origin !== self.location.origin) {
    if (!/\.(mp4|webm|webp|jpg|jpeg|png|gif)(\?|$)/i.test(url.pathname)) return;
    event.respondWith((async () => {
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

  // Local media files — cache-first, then the offline download pack
  if (url.pathname.match(/\/media\//)) {
    event.respondWith(
      caches.open(MEDIA_CACHE).then((cache) =>
        cache.match(event.request).then(async (cached) => {
          if (cached) return cached;
          const offlineHit = await matchOfflineMedia(event.request);
          if (offlineHit) return offlineHit;
          return fetch(event.request).then((response) => {
            if (response.ok || response.type === 'opaque') {
              safeCachePut(cache, event.request, response.clone()).then(() =>
                cache.keys().then((keys) => {
                  if (keys.length > MEDIA_CACHE_LIMIT) {
                    const toDelete = keys.slice(0, keys.length - MEDIA_CACHE_LIMIT);
                    toDelete.forEach((key) => cache.delete(key));
                  }
                })
              );
            }
            return response;
          }).catch(() =>
            matchOfflineMedia(event.request).then((hit) =>
              hit || new Response('', { status: 503, statusText: 'Offline' })
            )
          );
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
        caches.open(APP_SHELL_CACHE).then((cache) => {
          safeCachePut(cache, event.request, response.clone());
        });
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
