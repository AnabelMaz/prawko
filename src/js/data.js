// data.js — JSON data loading with memory cache

const cache = new Map();
const inflight = new Map();

// Media URLs. Empty until `local.json` answers, so nothing is fetched from
// Backblaze while that request is still open. A 200 applies its options.
// A 404 or a failed read means the file is absent and media stays on B2.
// The first screen does not wait that out: see `firstScreenLocalConfig`.
export const MEDIA_CDN = 'https://f003.backblazeb2.com/file/prawko-maz';
const PACKS_CDN = 'https://pub-e8e3a36b9ab44034913636d87ee3f0ee.r2.dev';

export let MEDIA_BASE = '';
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

/** How long the first screen may wait. A fast 404 (GitHub Pages) returns
 *  before this and the screen continues at once. This timer does not cancel
 *  the request and does not mean the file is missing. */
export const LOCAL_JSON_WAIT_MS = 1000;

/** A socket that never sends a status. Existence is the status line, not this. */
const LOCAL_JSON_HANG_MS = 8000;

export function loadLocalConfig() {
  if (!localConfigPromise) {
    localConfigPromise = (async () => {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), LOCAL_JSON_HANG_MS);
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
        if (!MEDIA_BASE) MEDIA_BASE = MEDIA_CDN;
      }
    })();
  }
  return localConfigPromise;
}

/** Let the home screen paint. `loadLocalConfig` keeps running and applies
 *  `mediaBase` when the status line arrives, including after this wait. */
export function firstScreenLocalConfig() {
  return Promise.race([
    loadLocalConfig(),
    new Promise((resolve) => { setTimeout(resolve, LOCAL_JSON_WAIT_MS); }),
  ]);
}

function isRemoteMediaBase(base = MEDIA_BASE) {
  return /^https?:\/\//i.test(String(base || ''));
}

export function usesLocalMedia(base = MEDIA_BASE) {
  return Boolean(base) && !isRemoteMediaBase(base);
}

/** This browser is on the same computer as the page origin (not “LAN vs WAN”). */
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

function fetchJson(url) {
  const key = `url:${url}`;
  if (cache.has(key)) return Promise.resolve(cache.get(key));
  if (inflight.has(key)) return inflight.get(key);
  const promise = fetch(url)
    .then((res) => {
      if (!res.ok) throw new Error(`Failed to load ${url}: ${res.status}`);
      return res.json();
    })
    .then((data) => {
      cache.set(key, data);
      return data;
    })
    .finally(() => inflight.delete(key));
  inflight.set(key, promise);
  return promise;
}

function assembleQuestion(id, fact, text) {
  const key = String(id);
  const q = {
    id: typeof id === 'number' ? id : (/^\d+$/.test(key) ? Number(key) : id),
    q: (text && text.q) || '',
    type: fact && fact.type,
    correct: fact && fact.correct,
    points: fact && fact.points,
    media: fact && fact.media ? fact.media : null,
    mediaType: fact && fact.mediaType ? fact.mediaType : null,
  };
  const mediaIn = Number(fact && fact.mediaIn);
  const mediaOut = Number(fact && fact.mediaOut);
  if (Number.isFinite(mediaIn) && mediaIn > 0.04) q.mediaIn = mediaIn;
  if (Number.isFinite(mediaOut) && mediaOut > 0.04) q.mediaOut = mediaOut;
  if (text && (text.a || text.b || text.c)) {
    q.a = text.a || '';
    q.b = text.b || '';
    q.c = text.c || '';
  }
  return q;
}

// Category files are id lists. The query skips a service-worker data cache
// that still holds the previous full-question files under the same name.
const CATEGORY_FILE_REV = '2';

function fetchCategoryFile(cat) {
  const key = `catfile_${cat}`;
  if (cache.has(key)) return Promise.resolve(cache.get(key));
  if (inflight.has(key)) return inflight.get(key);
  const promise = fetch(`data/${encodeURIComponent(cat)}.json?v=${CATEGORY_FILE_REV}`)
    .then((res) => {
      if (!res.ok) throw new Error(`Failed to load category ${cat}: ${res.status}`);
      return res.json();
    })
    .then((data) => {
      if (!data || !Array.isArray(data.questionIds)) {
        throw new Error(`Category ${cat} has no questionIds`);
      }
      cache.set(key, data);
      return data;
    })
    .finally(() => inflight.delete(key));
  inflight.set(key, promise);
  return promise;
}

function loadQuestionFacts() {
  return fetchJson('data/questions.json');
}

let questionBankWarmPromise = null;
let questionBankWarmDone = false;

/** True after warmQuestionBank finished (success or failure). */
export function isQuestionBankWarm() {
  return questionBankWarmDone;
}

/**
 * Prefetch questions.json + translations_pl.json into the same memory cache
 * fetchCategory uses. Call early so category entry does not wait on a cold link.
 */
export function warmQuestionBank() {
  if (questionBankWarmPromise) return questionBankWarmPromise;
  questionBankWarmPromise = Promise.all([
    loadQuestionFacts(),
    fetchJson('data/translations_pl.json'),
  ])
    .then(() => {
      questionBankWarmDone = true;
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('question-bank-ready'));
      }
    })
    .catch((err) => {
      // Unlock category cards even on failure; launchSession still handles errors.
      questionBankWarmDone = true;
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('question-bank-ready', { detail: { error: err } }));
      }
    });
  return questionBankWarmPromise;
}

/** Media names for one category. Question text is not required, so this does
 *  not wait for `translations_pl.json`. */
export async function fetchCategoryMediaList(cat) {
  const [file, facts] = await Promise.all([
    fetchCategoryFile(cat),
    loadQuestionFacts(),
  ]);
  const seen = new Set();
  const questions = [];
  for (const id of file.questionIds) {
    const fact = facts[String(id)];
    const media = fact && fact.media;
    if (!media || seen.has(media)) continue;
    seen.add(media);
    questions.push({ media, mediaType: fact.mediaType || null });
  }
  return { category: file.category || cat, questions };
}

export async function fetchCategory(cat) {
  const key = `cat_${cat}`;
  if (cache.has(key)) return cache.get(key);
  if (inflight.has(key)) return inflight.get(key);
  const promise = fetchCategoryFile(cat)
    .then(async (data) => {
      const [facts, polish] = await Promise.all([
        loadQuestionFacts(),
        fetchJson('data/translations_pl.json'),
      ]);
      const questions = data.questionIds.map((id) => (
        assembleQuestion(id, facts[String(id)], polish[String(id)])
      ));
      const bank = { category: data.category || cat, questions };
      cache.set(key, bank);
      return bank;
    })
    .finally(() => inflight.delete(key));
  inflight.set(key, promise);
  return promise;
}
