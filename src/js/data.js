// data.js — JSON data loading with memory cache

const cache = new Map();
const inflight = new Map();

// Media base URL — set to CDN origin for external media hosting
// Falls back to local relative path for development
export const MEDIA_CDN = 'https://f003.backblazeb2.com/file/prawko-maz';
export const MEDIA_BASE = MEDIA_CDN;

export function isRemoteMediaBase(base = MEDIA_BASE) {
  return /^https?:\/\//i.test(String(base || ''));
}

export function usesLocalMedia(base = MEDIA_BASE) {
  return Boolean(base) && !isRemoteMediaBase(base);
}

export function getMediaUrls(media, mediaType) {
  if (!media) return [];
  const prefix = mediaType === 'video' ? 'vid' : 'img';
  const encoded = encodeURIComponent(media);
  const bases = [];
  for (const base of [MEDIA_BASE, MEDIA_CDN]) {
    if (base && !bases.includes(base)) bases.push(base);
  }
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
