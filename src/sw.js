importScripts('./js/range-assemble.js');

const CACHE_VERSION = 'prawko-v144';
const APP_SHELL_CACHE = CACHE_VERSION + '-shell';
const DATA_CACHE = CACHE_VERSION + '-data';
const MEDIA_CACHE = CACHE_VERSION + '-media';
const OFFLINE_MEDIA_CACHE = 'prawko-offline-media-v1';

// Code / UI only — no data/*.json (those go in DATA_PRECACHE).
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
  './js/help-popover.js',
  './js/offline.js',
  './js/media-feed.js',
  './js/range-assemble.js',
  './js/category-pack.js',
  './js/zip.js',
  './js/scale.js',
  './js/scale-boot.js',
  './js/fit-text.js',
  './manifest.json',
  './icons/icon.svg',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/cursor-black.png',
  './icons/cursor-white.png',
  './icons/cursor-pointer-black.png',
  './icons/cursor-pointer-white.png',
  './icons/cursor-unavailable-black.png',
  './icons/cursor-unavailable-white.png',
  './fonts/NotoSansSymbols-Regular.ttf',
  './fonts/inter-latin-wght-normal.woff2',
  './fonts/inter-latin-ext-wght-normal.woff2',
  './fonts/inter-cyrillic-wght-normal.woff2',
  './fonts/dm-sans-latin-wght-normal.woff2',
  './fonts/dm-sans-latin-ext-wght-normal.woff2'
];

// Question bank JSON — only in DATA_CACHE (no overlap with APP_SHELL).
const DATA_PRECACHE = [
  './data/meta.json',
  './data/questions.json',
  './data/translations_pl.json',
  './data/translations_en.json',
  './data/translations_de.json',
  './data/translations_uk.json',
  './data/A.json',
  './data/A1.json',
  './data/A2.json',
  './data/AM.json',
  './data/B.json',
  './data/B1.json',
  './data/C.json',
  './data/C1.json',
  './data/D.json',
  './data/D1.json',
  './data/PT.json',
  './data/T.json'
];

function videoAssemblyKey(href) {
  try {
    const u = new URL(href);
    u.search = '';
    u.hash = '';
    return u.href;
  } catch {
    return href;
  }
}

/** Fetch each URL into cache; one 404 must not abort the whole install. */
async function precacheUrls(cacheName, urls) {
  const cache = await caches.open(cacheName);
  const results = await Promise.allSettled(
    urls.map(async (url) => {
      const res = await fetch(url, { cache: 'no-cache' });
      if (!res.ok) throw new Error(`${url} → ${res.status}`);
      await cache.put(url, res);
    })
  );
  for (let i = 0; i < results.length; i++) {
    if (results[i].status === 'rejected') {
      console.warn('[prawko sw] precache failed:', urls[i], results[i].reason);
    }
  }
}

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    await precacheUrls(APP_SHELL_CACHE, APP_SHELL);
    await precacheUrls(DATA_CACHE, DATA_PRECACHE);
  })());
});

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

async function serveCachedMedia(cached, request) {
  // Slice the cached blob. Copying the whole file into one buffer before
  // answering Range is what delayed the first frame.
  const blob = await cached.blob();
  const total = blob.size;
  const storedType = cached.headers.get('Content-Type') || blob.type || 'application/octet-stream';
  const range = request && request.headers ? request.headers.get('Range') : '';
  const parsed = total > 0 ? self.PrawkoRangeAssemble.parseRequestRange(range, total) : null;
  const headers = {
    'Content-Type': storedType,
    'Accept-Ranges': 'bytes',
    'Access-Control-Allow-Origin': self.location.origin || '*',
  };
  if (!parsed || (parsed.start === 0 && parsed.end === total - 1)) {
    headers['Content-Length'] = String(total);
    return new Response(blob, { status: 200, headers });
  }
  const slice = blob.slice(parsed.start, parsed.end + 1, storedType);
  headers['Content-Length'] = String(slice.size);
  headers['Content-Range'] = `bytes ${parsed.start}-${parsed.end}/${total}`;
  return new Response(slice, { status: 206, headers });
}

async function matchOfflineMedia(request) {
  const cache = await caches.open(OFFLINE_MEDIA_CACHE);
  const raw = typeof request === 'string' ? request : request.url;
  const url = videoAssemblyKey(raw);
  const opts = { ignoreSearch: true, ignoreVary: true };
  // Never match the player Range request — Cache Storage stores a full 200.
  const direct = (await cache.match(url, opts))
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

function isLoopbackHostName(host) {
  return host === 'localhost' || host === '127.0.0.1' || host === '[::1]';
}

// Loopback + same-origin /media/: files already on this computer — pass through.
// LAN hostname (e.g. node-oczkowscy) and CDN: remember viewed responses.
function viewedMediaStaysOnDisk(url) {
  return isLoopbackHostName(self.location.hostname)
    && url.origin === self.location.origin
    && /\/media\//.test(url.pathname);
}

function playedMediaKind(href, contentType) {
  const type = String(contentType || '').toLowerCase();
  if (type.startsWith('video/')) return 'video';
  if (type.startsWith('image/')) return 'image';
  try {
    const path = new URL(href).pathname;
    if (/\.(mp4|webm)$/i.test(path)) return 'video';
    if (/\.(webp|jpe?g|png|gif)$/i.test(path)) return 'image';
  } catch { /* ignore */ }
  return '';
}

const playedMediaAssembler = self.PrawkoRangeAssemble.createAssembler();

async function storePlayedMedia(href, blob, mime) {
  const cache = await caches.open(OFFLINE_MEDIA_CACHE);
  const key = videoAssemblyKey(href);
  const type = mime || blob.type || 'application/octet-stream';
  await cache.put(new Request(key), new Response(blob, {
    status: 200,
    headers: {
      'Content-Type': type,
      'Content-Length': String(blob.size),
    },
  }));
  offlineMediaUrls.add(key);
  try {
    const u = new URL(key);
    offlineMediaUrls.add(u.origin + u.pathname);
  } catch { /* ignore a bad key */ }
  const tail = mediaPathTail(key);
  if (tail && !offlineMediaByTail.has(tail)) offlineMediaByTail.set(tail, key);
  const clients = await self.clients.matchAll({ type: 'window' });
  clients.forEach((client) => client.postMessage({ type: 'OFFLINE_MEDIA_UPDATED' }));
}

async function rememberPlayedMedia(href, response) {
  if (!response || response.type === 'opaque' || response.type === 'opaqueredirect') return;
  const kind = playedMediaKind(href, response.headers.get('Content-Type'));
  if (!kind) return;
  const max = self.PrawkoRangeAssemble.MAX_RANGE_ASM;
  const min = kind === 'video' ? self.PrawkoRangeAssemble.MIN_RANGE_BYTES : 32;
  if (response.status === 200) {
    const blob = await response.blob();
    if (blob.size < min || blob.size > max) return;
    await storePlayedMedia(href, blob, blob.type || response.headers.get('Content-Type'));
    return;
  }
  if (response.status !== 206 || kind !== 'video') return;
  const header = response.headers.get('Content-Range') || '';
  const parsed = self.PrawkoRangeAssemble.parseContentRange(header);
  const buf = new Uint8Array(await response.arrayBuffer());
  if (parsed && parsed.start === 0 && parsed.total > 0 && buf.byteLength === parsed.total) {
    if (buf.byteLength < min || buf.byteLength > max) return;
    await storePlayedMedia(href, new Blob([buf], { type: response.headers.get('Content-Type') || 'video/mp4' }), response.headers.get('Content-Type'));
    return;
  }
  const done = playedMediaAssembler.pushChunk(
    videoAssemblyKey(href),
    206,
    header,
    buf,
    response.headers.get('Content-Type') || 'video/mp4',
  );
  if (!done) return;
  await storePlayedMedia(done.key, new Blob([done.buf], { type: done.mime || 'video/mp4' }), done.mime);
}

async function fetchAndRememberMedia(event, url) {
  const cached = await matchOfflineMedia(event.request);
  if (cached) return serveCachedMedia(cached, event.request);
  const res = await fetch(event.request);
  if (res && res.ok && res.type !== 'opaque' && res.type !== 'opaqueredirect') {
    const copy = res.clone();
    event.waitUntil(rememberPlayedMedia(url.href, copy).catch(() => {}));
  }
  return res;
}

function isStationMediaUrl(url) {
  if (url.origin !== self.location.origin) {
    return /\.(mp4|webm|webp|jpg|jpeg|png|gif)(\?|$)/i.test(url.pathname);
  }
  return /\/media\//.test(url.pathname);
}

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  if (event.request.method !== 'GET') return;
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return;
  if (url.pathname.endsWith('/sw.js')) return;
  // Optional self-host settings. Network-first; cache only 200 so offline
  // keeps mediaBase/etc. A 404 drops any stale entry (defaults again).
  if (url.pathname.endsWith('/local.json')) {
    event.respondWith(
      caches.open(DATA_CACHE).then(async (cache) => {
        try {
          const response = await fetch(event.request);
          if (response.ok) {
            await safeCachePut(cache, event.request, response.clone());
            return response;
          }
          await cache.delete(event.request);
          return response;
        } catch {
          const cached = await cache.match(event.request);
          if (cached) return cached;
          throw new TypeError('Failed to fetch local.json');
        }
      })
    );
    return;
  }
  // CDN and /media/: cache hit for the player; miss returns the network
  // response and keeps a copy (covers the no-CORS element fallback).
  // Loopback disk files are not intercepted.
  if (isStationMediaUrl(url)) {
    if (!viewedMediaStaysOnDisk(url)) event.respondWith(fetchAndRememberMedia(event, url));
    return;
  }

  // All data/*.json (incl. meta) — stale-while-revalidate; only in DATA_CACHE.
  if (url.pathname.includes('/data/') && url.pathname.endsWith('.json')) {
    event.respondWith(
      caches.open(DATA_CACHE).then(async (cache) => {
        const cached = await cache.match(event.request);
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
    );
    return;
  }

  if (url.pathname.includes('/icons/') || url.pathname.includes('/fonts/')) {
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
