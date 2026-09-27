// data.js — JSON data loading with memory cache

const cache = new Map();
const inflight = new Map();

// Media URLs. One start state for every host: the published CDN.
// Same-origin `local.json` is optional. When the admin has files on this
// server, the installer writes that file (`mediaBase: media`) and the app
// switches to `/media/`. Missing or slow `local.json` does not block startup.
export const MEDIA_CDN = 'https://f003.backblazeb2.com/file/prawko-maz';
export const PACKS_CDN = 'https://pub-e8e3a36b9ab44034913636d87ee3f0ee.r2.dev';

export let MEDIA_BASE = MEDIA_CDN;
export let PACKS_BASE = PACKS_CDN;
export let OFFLINE_DOWNLOAD = 'packs';

function applyLocalConfig(data) {
  if (!data || typeof data !== 'object') return;
  if (data.mediaBase === 'media') {
    MEDIA_BASE = 'media';
    if (data.offlineDownload !== 'packs' && data.offlineDownload !== 'files') {
      OFFLINE_DOWNLOAD = 'files';
    }
  } else if (data.mediaBase === 'cdn') {
    MEDIA_BASE = MEDIA_CDN;
    if (data.offlineDownload !== 'packs' && data.offlineDownload !== 'files') {
      OFFLINE_DOWNLOAD = 'packs';
    }
  }
  if (typeof data.packsBase === 'string' && data.packsBase.trim()) {
    PACKS_BASE = data.packsBase.trim().replace(/\/+$/, '');
  }
  if (data.offlineDownload === 'files' || data.offlineDownload === 'packs') {
    OFFLINE_DOWNLOAD = data.offlineDownload;
  }
}

let localConfigPromise = null;

/** Same-origin `local.json` is tiny when present. Bound the wait so a missing
 *  file or a slow origin 404 cannot stall the first screen on any host. */
export const LOCAL_JSON_WAIT_MS = 1000;

export function loadLocalConfig() {
  if (!localConfigPromise) {
    localConfigPromise = (async () => {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), LOCAL_JSON_WAIT_MS);
      try {
        const res = await fetch(new URL('local.json', document.baseURI), {
          cache: 'no-store',
          signal: ctrl.signal,
        });
        if (!res.ok) return {};
        const data = await res.json();
        applyLocalConfig(data);
        return data && typeof data === 'object' ? data : {};
      } catch {
        return {};
      } finally {
        clearTimeout(timer);
      }
    })();
  }
  return localConfigPromise;
}

export function isRemoteMediaBase(base = MEDIA_BASE) {
  return /^https?:\/\//i.test(String(base || ''));
}

export function usesLocalMedia(base = MEDIA_BASE) {
  return Boolean(base) && !isRemoteMediaBase(base);
}

export function isLoopbackHost() {
  if (typeof location === 'undefined') return false;
  const host = location.hostname;
  return host === 'localhost' || host === '127.0.0.1' || host === '[::1]';
}

export function getMediaUrls(media, mediaType) {
  if (!media) return [];
  const prefix = mediaType === 'video' ? 'vid' : 'img';
  const encoded = encodeURIComponent(media);
  const bases = [];
  if (MEDIA_BASE) bases.push(MEDIA_BASE);
  const urls = [];
  for (const base of bases) {
    const withEncoding = `${base}/${prefix}/${encoded}`;
    const raw = `${base}/${prefix}/${media}`;
    if (!urls.includes(withEncoding)) urls.push(withEncoding);
    if (raw !== withEncoding && !urls.includes(raw)) urls.push(raw);
  }
  return urls;
}

export async function fetchMeta() {
  if (cache.has('meta')) return cache.get('meta');
  if (inflight.has('meta')) return inflight.get('meta');
  const promise = fetch('data/meta.json')
    .then(res => {
      if (!res.ok) throw new Error(`Failed to load meta: ${res.status}`);
      return res.json();
    })
    .then(data => {
      cache.set('meta', data);
      return data;
    })
    .finally(() => inflight.delete('meta'));
  inflight.set('meta', promise);
  return promise;
}

export async function fetchUniqueQuestionCount() {
  if (cache.has('uniqueCount')) return cache.get('uniqueCount');
  if (inflight.has('uniqueCount')) return inflight.get('uniqueCount');
  const promise = (async () => {
    const meta = await fetchMeta();
    const listed = Number(meta?.uniqueQuestionCount);
    if (Number.isFinite(listed) && listed > 0) return listed;
    const banks = await Promise.all((meta?.categories || []).map((c) => fetchCategory(c.id)));
    const ids = new Set();
    for (const bank of banks) {
      for (const q of bank.questions || []) ids.add(String(q.id));
    }
    return ids.size;
  })().then((n) => {
    cache.set('uniqueCount', n);
    return n;
  }).finally(() => inflight.delete('uniqueCount'));
  inflight.set('uniqueCount', promise);
  return promise;
}

export async function fetchCategory(cat) {
  const key = `cat_${cat}`;
  if (cache.has(key)) return cache.get(key);
  if (inflight.has(key)) return inflight.get(key);
  const promise = fetch(`data/${encodeURIComponent(cat)}.json`)
    .then(res => {
      if (!res.ok) throw new Error(`Failed to load category ${cat}: ${res.status}`);
      return res.json();
    })
    .then(data => {
      cache.set(key, data);
      return data;
    })
    .finally(() => inflight.delete(key));
  inflight.set(key, promise);
  return promise;
}
