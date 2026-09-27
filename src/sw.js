importScripts('./js/media-assemble.js');

const CACHE_VERSION = 'prawko-v131';
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
  './js/media-assemble.js',
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
  './icons/cursor-pointer-white.png',
  './fonts/NotoSansSymbols-Regular.ttf'
];

const videoAssembler = self.PrawkoVideoAssemble.createAssembler();
const MAX_VIDEO_ASM = self.PrawkoVideoAssemble.MAX_VIDEO_ASM;

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

function isAssemblableVideo(url) {
  return self.PrawkoVideoAssemble.shouldAssembleVideo(
    self.location.origin,
    self.location.hostname,
    url.href,
  );
}

function rememberAssembledVideo(key, buf, mime) {
  const type = mime && String(mime).startsWith('video/')
    ? String(mime).split(';')[0].trim()
    : (/\.webm$/i.test(key) ? 'video/webm' : 'video/mp4');
  const headers = { 'Content-Type': type, 'Content-Length': String(buf.byteLength) };
  return caches.open(OFFLINE_MEDIA_CACHE).then((cache) => (
    cache.put(
      new Request(key, { mode: 'cors' }),
      new Response(buf, { status: 200, headers }),
    )
  )).then(() => {
    offlineMediaUrls.add(key);
    try {
      const u = new URL(key);
      offlineMediaUrls.add(u.origin + u.pathname);
    } catch { /* ignore */ }
    const tail = mediaPathTail(key);
    if (tail && !offlineMediaByTail.has(tail)) offlineMediaByTail.set(tail, key);
  }).catch(() => {});
}

async function fetchVideoForPlayer(request) {
  const range = request.headers.get('Range');
  try {
    const headers = new Headers();
    if (range) headers.set('Range', range);
    const res = await fetch(new Request(request.url, {
      method: 'GET',
      mode: 'cors',
      credentials: 'omit',
      headers,
    }));
    if (res.type !== 'opaque' && (res.status === 200 || res.status === 206)) return res;
  } catch { /* play without assembling */ }
  return fetch(request);
}

async function passThroughAndAssemble(event) {
  const key = videoAssemblyKey(event.request.url);
  const res = await fetchVideoForPlayer(event.request);
  if (!res.body || res.type === 'opaque') return res;
  const [play, collect] = res.body.tee();
  const status = res.status;
  const mime = res.headers.get('Content-Type') || '';
  const contentRange = res.headers.get('Content-Range') || '';
  event.waitUntil((async () => {
    try {
      const chunk = new Uint8Array(await collect.arrayBuffer());
      if (chunk.byteLength > MAX_VIDEO_ASM) {
        videoAssembler.drop();
        return;
      }
      const done = videoAssembler.pushChunk(key, status, contentRange, chunk, mime);
      if (done) await rememberAssembledVideo(done.key, done.buf, done.mime);
    } catch {
      /* aborted mid-range: keep holes, never store a partial file */
    }
  })());
  return new Response(play, { status: res.status, statusText: res.statusText, headers: res.headers });
}

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
  // CDN media: serve from the offline pack when we already have the file.
  // Uncached videos pass through and are stored only if every byte arrives.
  // Images stay on the page capture path (no extra SW hop).
  if (url.origin !== self.location.origin) {
    if (!/\.(mp4|webm|webp|jpg|jpeg|png|gif)(\?|$)/i.test(url.pathname)) return;
    const indexReady = offlineMediaUrls.size > 0 || offlineMediaByTail.size > 0;
    const known = indexReady && remoteMediaCached(url.href);
    if (indexReady && !known) {
      if (isAssemblableVideo(url)) event.respondWith(passThroughAndAssemble(event));
      return;
    }
    event.respondWith((async () => {
      if (!indexReady) await rebuildOfflineMediaIndex();
      if (remoteMediaCached(url.href)) {
        const cached = await matchOfflineMedia(event.request);
        if (cached) return cached;
      }
      if (isAssemblableVideo(url)) return passThroughAndAssemble(event);
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

  // Local /media/ — serve a cached pack hit. On LAN (not localhost) also
  // assemble uncached videos the same way as CDN. Loopback stays passthrough
  // so this machine does not copy files it already has on disk.
  if (url.pathname.match(/\/media\//)) {
    if (remoteMediaCached(url.href)) {
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
    if (isAssemblableVideo(url)) {
      event.respondWith(passThroughAndAssemble(event));
      return;
    }
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
