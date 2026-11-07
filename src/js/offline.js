// offline.js — Offline download management

import { fetchMeta, fetchCategoryMediaList, getMediaUrls, usesLocalMedia, isLoopbackHost, PACKS_BASE, OFFLINE_DOWNLOAD, loadLocalConfig } from './data.js';
import { forEachZipFile } from './zip.js';

const DOWNLOAD_KEY = 'prawko_offline';
const MANIFEST_KEY = 'prawko_offline_manifest';
const PACKS_DONE_KEY = 'prawko_offline_packs';
const IN_PROGRESS_KEY = 'prawko_offline_in_progress';
const OFFLINE_CACHE = 'prawko-offline-media-v1';
const IDB_NAME = 'prawko-offline-media';
const IDB_STORE = 'files';
const BATCH_SIZE = 2;
const FILE_TIMEOUT_MS = 120000;
const FILE_RETRIES = 3;

function getMediaRequest(url) {
  try {
    const abs = new URL(url, typeof location !== 'undefined' ? location.href : undefined);
    if (typeof location !== 'undefined' && abs.origin === location.origin) {
      return new Request(abs.href, { cache: 'no-store' });
    }
    return new Request(abs.href, { mode: 'no-cors', cache: 'no-store' });
  } catch {
    return new Request(url, { mode: 'no-cors', cache: 'no-store' });
  }
}

async function fetchMediaResponse(request, userSignal) {
  let lastErr = null;
  for (let attempt = 0; attempt < FILE_RETRIES; attempt++) {
    if (userSignal?.aborted) throw userSignal.reason || new DOMException('Aborted', 'AbortError');
    const timeoutCtrl = new AbortController();
    const timer = setTimeout(() => timeoutCtrl.abort(), FILE_TIMEOUT_MS);
    const onUserAbort = () => timeoutCtrl.abort();
    userSignal?.addEventListener('abort', onUserAbort);
    try {
      const response = await fetch(request, { signal: timeoutCtrl.signal });
      clearTimeout(timer);
      userSignal?.removeEventListener('abort', onUserAbort);
      return response;
    } catch (err) {
      clearTimeout(timer);
      userSignal?.removeEventListener('abort', onUserAbort);
      if (userSignal?.aborted) throw err;
      lastErr = err;
    }
  }
  throw lastErr || new Error('media fetch failed');
}

function notifyServiceWorkerOfflineMedia() {
  try {
    navigator.serviceWorker?.controller?.postMessage({ type: 'OFFLINE_MEDIA_UPDATED' });
  } catch { /* no controller yet */ }
}

export function isAppOnline() {
  return typeof navigator === 'undefined' || navigator.onLine !== false;
}

export function getCategoryMediaAccess(categoryId, downloadedSet = new Set(), options = {}) {
  const localMedia = options.localMedia ?? usesLocalMedia();
  const loopback = options.loopback ?? isLoopbackHost();
  const online = options.online ?? isAppOnline();
  const downloaded = Boolean(categoryId) && downloadedSet.has(categoryId);
  const completeCoverage = Number(options.coveragePct) >= 100;

  if ((localMedia && loopback) || downloaded || completeCoverage) {
    return { available: true, offlineReady: true, canDownload: false };
  }
  if (online) {
    return { available: true, offlineReady: false, canDownload: true };
  }
  return { available: false, offlineReady: false, canDownload: false };
}

/** Hue 0 (red) → 120 (green) for 0–100% offline media coverage. */
export function offlineCoverageHue(pct) {
  const n = Number(pct);
  const clamped = Number.isFinite(n) ? Math.max(0, Math.min(100, n)) : 0;
  return Math.round(clamped * 1.2);
}

function mediaPathTail(href) {
  try {
    const base = typeof location !== 'undefined' ? location.href : 'https://example.invalid/';
    const u = new URL(href, base);
    const m = u.pathname.match(/\/(vid|img)\/[^/]+$/i);
    return m ? m[0].toLowerCase() : '';
  } catch {
    return '';
  }
}

function addMediaCacheKeys(set, url) {
  if (!url) return;
  set.add(url);
  const tail = mediaPathTail(url);
  if (tail) set.add(tail);
  try {
    const base = typeof location !== 'undefined' ? location.href : 'https://example.invalid/';
    const u = new URL(url, base);
    set.add(u.href);
    const file = u.pathname.split('/').pop();
    if (file) {
      set.add(file);
      try { set.add(decodeURIComponent(file)); } catch { /* keep encoded */ }
    }
  } catch {
    const file = String(url).split('/').pop();
    if (file) set.add(file);
  }
}

function urlIsCached(url, cachedSet) {
  if (!url || !cachedSet) return false;
  const keys = new Set();
  addMediaCacheKeys(keys, url);
  for (const key of keys) {
    if (cachedSet.has(key)) return true;
  }
  return false;
}

function mediaCacheIsPersistent() {
  return typeof isSecureContext === 'undefined' || isSecureContext !== false;
}

/** Same gate as storeMediaBlob — secure context Cache Storage vs IDB. */
export function canUseOfflineMediaCache() {
  return mediaCacheIsPersistent() && typeof caches !== 'undefined' && Boolean(caches.open);
}

let offlineCacheHandle = null;

export async function openOfflineCache() {
  if (!mediaCacheIsPersistent()) return null;
  if (typeof caches === 'undefined') return null;
  if (offlineCacheHandle) return offlineCacheHandle;
  try {
    offlineCacheHandle = await caches.open(OFFLINE_CACHE);
    return offlineCacheHandle;
  } catch {
    offlineCacheHandle = null;
    return null;
  }
}

let cachedCacheKeys = null;
let cachedIdbKeys = null;

function invalidateOfflineMediaKeys() {
  cachedCacheKeys = null;
  cachedIdbKeys = null;
}

if (typeof navigator !== 'undefined' && navigator.serviceWorker) {
  navigator.serviceWorker.addEventListener('message', (event) => {
    if (event.data?.type === 'OFFLINE_MEDIA_UPDATED') invalidateOfflineMediaKeys();
  });
}

async function listOfflineCacheKeys(cache) {
  if (cachedCacheKeys && cachedCacheKeys.cache === cache) return cachedCacheKeys.keys;
  const keys = await cache.keys();
  cachedCacheKeys = { cache, keys };
  return keys;
}

async function listIdbMediaKeys() {
  if (cachedIdbKeys) return cachedIdbKeys;
  const keys = await idbKeys();
  cachedIdbKeys = keys;
  return keys;
}

/** Reused IDB connection — open/close per get was too slow on the learn hot path. */
let mediaDbPromise = null;

function openMediaDb() {
  if (mediaDbPromise) return mediaDbPromise;
  mediaDbPromise = new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB is not available'));
      return;
    }
    const req = indexedDB.open(IDB_NAME, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(IDB_STORE)) {
        req.result.createObjectStore(IDB_STORE);
      }
    };
    req.onsuccess = () => {
      const db = req.result;
      db.onclose = () => { mediaDbPromise = null; };
      db.onversionchange = () => {
        try { db.close(); } catch { /* ignore */ }
        mediaDbPromise = null;
      };
      resolve(db);
    };
    req.onerror = () => {
      mediaDbPromise = null;
      reject(req.error || new Error('IndexedDB open failed'));
    };
  }).catch((err) => {
    mediaDbPromise = null;
    throw err;
  });
  return mediaDbPromise;
}

function copyIdbValue(value) {
  if (!(value instanceof Blob)) return Promise.resolve(value);
  const type = value.type || 'application/octet-stream';
  return value.arrayBuffer().then((buf) => new Blob([buf], { type }));
}

function idbRequest(mode, run) {
  return openMediaDb().then((db) => new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, mode);
    const req = run(tx.objectStore(IDB_STORE));
    let settled = false;
    let txDone = false;
    let copyDone = false;
    let copiedValue;
    const fail = (err) => {
      if (settled) return;
      settled = true;
      reject(err);
    };
    const tryFinish = () => {
      if (settled || !txDone || !copyDone) return;
      settled = true;
      resolve(copiedValue);
    };
    req.onsuccess = () => {
      copyIdbValue(req.result).then((value) => {
        copiedValue = value;
        copyDone = true;
        tryFinish();
      }).catch(fail);
    };
    req.onerror = () => fail(req.error);
    tx.oncomplete = () => {
      txDone = true;
      tryFinish();
    };
    tx.onerror = () => fail(tx.error);
  }));
}

function idbPut(tail, blob) {
  return idbRequest('readwrite', (store) => store.put(blob, tail));
}

function idbGet(tail) {
  return idbRequest('readonly', (store) => store.get(tail));
}

function idbDelete(tail) {
  return idbRequest('readwrite', (store) => store.delete(tail));
}

function idbKeys() {
  return idbRequest('readonly', (store) => store.getAllKeys()).then((keys) => keys || []);
}

async function clonePlayableBlob(value, name) {
  if (!value) return null;
  const type = (value.type && String(value.type)) || mediaMime(name) || 'application/octet-stream';
  if (value instanceof Blob) {
    if (value.size < 1) return null;
    // Same bytes: avoid arrayBuffer() copy just to set MIME.
    if (!value.type || value.type === type) return value;
    return new Blob([value], { type });
  }
  if (value instanceof ArrayBuffer && value.byteLength > 0) {
    return new Blob([value], { type });
  }
  return null;
}

function idbKeyCandidates(media, mediaType) {
  const names = new Set();
  const raw = String(media || '');
  if (raw) {
    names.add(raw);
    names.add(raw.toLowerCase());
    try { names.add(decodeURIComponent(raw)); } catch { /* keep raw */ }
    try { names.add(decodeURIComponent(raw).toLowerCase()); } catch { /* keep raw */ }
  }
  const tails = new Set();
  for (const url of getMediaUrls(media, mediaType)) {
    const tail = mediaPathTail(url);
    if (tail) tails.add(tail);
  }
  return { names, tails };
}

async function idbGetMediaBlob(media, mediaType) {
  const { names, tails } = idbKeyCandidates(media, mediaType);
  for (const tail of tails) {
    try {
      const blob = await clonePlayableBlob(await idbGet(tail), media);
      if (blob) return blob;
    } catch { /* try next */ }
  }
  let keys = [];
  try {
    keys = await listIdbMediaKeys();
  } catch {
    return null;
  }
  for (const key of keys) {
    const file = String(key).split('/').pop() || '';
    let decoded = file;
    try { decoded = decodeURIComponent(file); } catch { /* keep encoded */ }
    const match = names.has(file)
      || names.has(file.toLowerCase())
      || names.has(decoded)
      || names.has(decoded.toLowerCase())
      || tails.has(String(key))
      || tails.has(String(key).toLowerCase());
    if (!match) continue;
    try {
      const blob = await clonePlayableBlob(await idbGet(key), media);
      if (blob) return blob;
    } catch { /* try next key */ }
  }
  return null;
}

export async function storeMediaBlob(url, blob) {
  if (!blob || blob.size < 1) throw new Error('empty media blob');
  const type = blob.type || mediaMime(url);
  const body = (!blob.type || blob.type === type) ? blob : new Blob([blob], { type });
  const abs = new URL(url, typeof location !== 'undefined' ? location.href : 'https://example.invalid/').href;
  const tail = mediaPathTail(abs);
  const cache = await openOfflineCache();
  if (cache) {
    try {
      // Exact URL only — ignoreSearch is an O(N) scan on large caches in Chrome.
      const existing = await cache.match(abs)
        || await cache.match(new Request(abs));
      if (existing) {
        const prevLen = Number(existing.headers.get('Content-Length')) || 0;
        if (prevLen === body.size) return;
        try {
          const prev = await existing.blob();
          if (prev && prev.size === body.size) return;
        } catch { /* replace below */ }
      }
      await cache.put(new Request(abs), new Response(body, {
        status: 200,
        headers: {
          'Content-Type': type,
          'Content-Length': String(body.size),
        },
      }));
      invalidateOfflineMediaKeys();
      notifyServiceWorkerOfflineMedia();
      return;
    } catch {
      /* Cache Storage can exist but reject puts; keep going to IndexedDB. */
    }
  }
  if (!tail) throw new Error('no media storage');
  await idbPut(tail, body);
  invalidateOfflineMediaKeys();
  notifyServiceWorkerOfflineMedia();
}

async function matchCachedMediaResponse(cache, media, mediaType) {
  const urls = getMediaUrls(media, mediaType);
  const { names, tails } = idbKeyCandidates(media, mediaType);

  // Exact URL first (same store keys as put — no ignoreSearch O(N) scan).
  for (const url of urls) {
    try {
      const abs = new URL(url, location.href).href;
      const hit = await cache.match(abs)
        || await cache.match(new Request(abs));
      if (hit) return hit;
    } catch { /* try next alias */ }
  }

  // Tail index from listed keys — avoid four Request-mode probes per URL.
  let keys = [];
  try {
    keys = await listOfflineCacheKeys(cache);
  } catch {
    return null;
  }
  const byTail = new Map();
  for (const req of keys) {
    const t = mediaPathTail(req.url);
    if (t && !byTail.has(t)) byTail.set(t, req);
  }
  for (const t of tails) {
    const req = byTail.get(t);
    if (!req) continue;
    try {
      const hit = await cache.match(req);
      if (hit) return hit;
    } catch { /* try next tail */ }
  }

  for (const req of keys) {
    const file = String(req.url).split('/').pop() || '';
    let decoded = file;
    try { decoded = decodeURIComponent(file); } catch { /* keep encoded */ }
    const match = names.has(file)
      || names.has(file.toLowerCase())
      || names.has(decoded)
      || names.has(decoded.toLowerCase());
    if (!match) continue;
    try {
      const hit = await cache.match(req);
      if (hit) return hit;
    } catch { /* try next key */ }
  }
  return null;
}

/**
 * @param {{ cache?: boolean }} [opts] — cache:false skips Cache Storage (exact miss
 * already checked; only IDB store-fallback remains).
 */
export async function getStoredMediaBlob(media, mediaType, opts = {}) {
  const useCache = opts.cache !== false;
  if (useCache) {
    const cache = await openOfflineCache();
    if (cache) {
      try {
        const hit = await matchCachedMediaResponse(cache, media, mediaType);
        if (hit) {
          const blob = await clonePlayableBlob(await hit.blob(), media);
          if (blob) return blob;
        }
      } catch { /* fall through to IndexedDB */ }
    }
  }
  return idbGetMediaBlob(media, mediaType);
}

export async function resolvePlayableMediaUrl(media, mediaType) {
  const blob = await getStoredMediaBlob(media, mediaType);
  if (!blob) return null;
  const minBytes = mediaType === 'video' ? 256 : 32;
  if (blob.size < minBytes) return null;
  return URL.createObjectURL(blob);
}

export function coverageFromUrls(neededUrls, cachedSet) {
  const total = neededUrls.length;
  if (total === 0) return { have: 0, total: 0, pct: 100 };
  let have = 0;
  for (const url of neededUrls) {
    const name = mediaFileNameFromUrl(url);
    // Basename first so media/ vs CDN needed URLs match the same IDB/cache tails.
    if ((name && nameInCachedSet(name, cachedSet)) || urlIsCached(url, cachedSet)) have++;
  }
  return { have, total, pct: Math.round((100 * have) / total) };
}

export async function getCachedUrlSet() {
  const cached = new Set();
  const cache = await openOfflineCache();
  if (cache) {
    try {
      const keys = await cache.keys();
      for (const req of keys) addMediaCacheKeys(cached, req.url);
    } catch { /* Cache Storage can be missing on http://lan-host */ }
  }
  try {
    const tails = await idbKeys();
    for (const key of tails) addMediaCacheKeys(cached, key);
  } catch { /* IndexedDB unavailable */ }
  return cached;
}

export async function getCategoriesOfflineCoverage(categoryIds) {
  await loadLocalConfig();
  const ids = Array.isArray(categoryIds) ? categoryIds : [];
  const map = {};
  if (usesLocalMedia() && isLoopbackHost()) {
    for (const id of ids) map[id] = { have: 1, total: 1, pct: 100 };
    return map;
  }
  const cached = await getCachedUrlSet();
  await Promise.all(ids.map(async (id) => {
    try {
      const data = await fetchCategoryMediaList(id);
      map[id] = coverageFromUrls(getCategoryMediaUrls(data), cached);
    } catch {
      map[id] = { have: 0, total: 1, pct: 0 };
    }
  }));
  return map;
}

export function getDownloadedCategories() {
  try {
    const data = JSON.parse(localStorage.getItem(DOWNLOAD_KEY));
    return Array.isArray(data) ? new Set(data) : new Set();
  } catch {
    return new Set();
  }
}

function saveDownloaded(set) {
  try { localStorage.setItem(DOWNLOAD_KEY, JSON.stringify([...set])); } catch {}
}

function loadManifest() {
  try {
    const data = JSON.parse(localStorage.getItem(MANIFEST_KEY));
    if (typeof data === 'object' && data !== null && !Array.isArray(data)) return data;
  } catch {}
  return {};
}

function saveManifest(manifest) {
  try { localStorage.setItem(MANIFEST_KEY, JSON.stringify(manifest)); } catch {}
}

function getCategoryMediaUrls(categoryData) {
  const seen = new Set();
  const mediaUrls = [];
  for (const q of categoryData.questions) {
    if (!q.media || seen.has(q.media)) continue;
    seen.add(q.media);
    const urls = getMediaUrls(q.media, q.mediaType);
    const remote = urls.find((u) => /^https?:\/\//i.test(u)) || urls[0];
    if (remote) mediaUrls.push(remote);
  }
  return mediaUrls;
}

let activeController = null;
let activeDownload = null;
let userStop = false;

export function getActiveDownloadCategory() {
  return activeDownload?.categoryId || null;
}

/** User asked to stop. Keeps bytes already stored and ends the job. */
export function stopDownload() {
  userStop = true;
  if (activeController) {
    activeController.abort();
    activeController = null;
  }
}

export function getActiveDownloadProgress(categoryId) {
  if (!activeDownload || activeDownload.categoryId !== categoryId) return null;
  return { done: activeDownload.done, total: activeDownload.total };
}

function attachDownloadProgress(categoryId, onProgress) {
  if (!activeDownload || activeDownload.categoryId !== categoryId) return;
  if (onProgress) {
    activeDownload.listeners.add(onProgress);
    onProgress(activeDownload.done, activeDownload.total);
  }
}

function emitDownloadProgress(done, total, extra) {
  if (!activeDownload) return;
  activeDownload.done = done;
  activeDownload.total = total;
  for (const fn of activeDownload.listeners) {
    try { fn(done, total, extra); } catch { /* listener gone */ }
  }
}

export async function downloadCategoryMedia(categoryId, onProgress) {
  if (activeDownload?.promise) {
    if (activeDownload.categoryId === categoryId) {
      attachDownloadProgress(categoryId, onProgress);
      return activeDownload.promise;
    }
    return { success: false, busy: true, cancelled: false, stopped: false, total: 0, failed: 0 };
  }
  userStop = false;
  setInProgressOfflineCategory(categoryId);
  activeDownload = {
    categoryId,
    done: 0,
    total: 1,
    listeners: new Set(onProgress ? [onProgress] : []),
    promise: null,
  };
  const run = (!usesLocalMedia() && OFFLINE_DOWNLOAD === 'packs' && PACKS_BASE)
    ? downloadCategoryMediaFromPacks
    : downloadCategoryMediaFromFiles;
  activeDownload.promise = run(categoryId, (done, total, extra) => {
    emitDownloadProgress(done, total, extra);
  }).finally(() => {
    if (activeDownload?.categoryId === categoryId) activeDownload = null;
  });
  return activeDownload.promise;
}

function loadPacksDone() {
  try {
    const data = JSON.parse(localStorage.getItem(PACKS_DONE_KEY));
    if (typeof data === 'object' && data !== null && !Array.isArray(data)) return data;
  } catch {}
  return {};
}

function savePacksDone(map) {
  try { localStorage.setItem(PACKS_DONE_KEY, JSON.stringify(map)); } catch {}
}

export function getInProgressOfflineCategory() {
  try {
    const raw = localStorage.getItem(IN_PROGRESS_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    const id = parsed?.categoryId;
    return typeof id === 'string' && id ? id : null;
  } catch {
    return null;
  }
}

function setInProgressOfflineCategory(categoryId) {
  try {
    if (categoryId) localStorage.setItem(IN_PROGRESS_KEY, JSON.stringify({ categoryId }));
    else localStorage.removeItem(IN_PROGRESS_KEY);
  } catch {}
}

export function clearInProgressOfflineCategory(categoryId) {
  if (!categoryId) return;
  if (getInProgressOfflineCategory() === categoryId) setInProgressOfflineCategory(null);
}

function mediaMime(name) {
  const lower = String(name).toLowerCase();
  if (lower.endsWith('.mp4')) return 'video/mp4';
  if (lower.endsWith('.webm')) return 'video/webm';
  if (lower.endsWith('.webp')) return 'image/webp';
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg';
  if (lower.endsWith('.png')) return 'image/png';
  if (lower.endsWith('.gif')) return 'image/gif';
  return 'application/octet-stream';
}

function packsBaseUrl() {
  return String(PACKS_BASE || '').replace(/\/+$/, '');
}

async function sha256hex(buffer) {
  const hash = await crypto.subtle.digest('SHA-256', buffer);
  return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function fetchPacksManifest(signal) {
  const res = await fetch(`${packsBaseUrl()}/manifest.json`, { signal, mode: 'cors', cache: 'no-store' });
  if (!res.ok) throw new Error(`Pack manifest ${res.status}`);
  return res.json();
}

// One committed chunk. Resume steps back this far and checks those bytes
// before keeping anything new, same idea as a download-manager piece
// (typical piece sizes sit between 128 KiB and 1 MiB). 256 KiB covers a
// torn last write without re-fetching a meaningful part of a pack.
const RESUME_REWIND_BYTES = 256 * 1024;
const STALL_MS = 30000;
const REAL_ERRORS_BEFORE_RESTART = 3;
const QUICK_RETRY_MS = 400;
const RETRY_BASE_MS = 2000;
const RETRY_MAX_MS = 30000;
const PARTIAL_DB = 'prawko-pack-partial';
const PARTIAL_STORE = 'chunks';

function attemptError(message, kind, packId, progressed) {
  const err = new Error(message);
  err.name = 'DownloadAttemptError';
  err.kind = kind;
  err.packId = packId || '';
  err.progressed = Boolean(progressed);
  return err;
}

function asBytes(value) {
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  return new Uint8Array(0);
}

let partialDbPromise = null;

function openPartialDb() {
  if (partialDbPromise) return partialDbPromise;
  partialDbPromise = new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB is not available'));
      return;
    }
    const req = indexedDB.open(PARTIAL_DB, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(PARTIAL_STORE)) {
        req.result.createObjectStore(PARTIAL_STORE);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error('partial store open failed'));
  }).catch((err) => {
    partialDbPromise = null;
    throw err;
  });
  return partialDbPromise;
}

function partialGet(key) {
  return openPartialDb().then((db) => new Promise((resolve, reject) => {
    const tx = db.transaction(PARTIAL_STORE, 'readonly');
    const req = tx.objectStore(PARTIAL_STORE).get(key);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  }));
}

function partialKeys() {
  return openPartialDb().then((db) => new Promise((resolve, reject) => {
    const tx = db.transaction(PARTIAL_STORE, 'readonly');
    const req = tx.objectStore(PARTIAL_STORE).getAllKeys();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  }));
}

function partialLength(packId) {
  return partialGet(`${packId}::len`).then((value) => {
    const n = Number(value);
    return Number.isFinite(n) && n > 0 ? n : 0;
  });
}

async function setPartialLength(packId, n) {
  const next = Math.max(0, Number(n) || 0);
  const keys = await partialKeys();
  const db = await openPartialDb();
  const mark = `${packId}::c::`;
  const lastKeep = next > 0 ? Math.floor((next - 1) / RESUME_REWIND_BYTES) : -1;
  await new Promise((resolve, reject) => {
    const tx = db.transaction(PARTIAL_STORE, 'readwrite');
    const store = tx.objectStore(PARTIAL_STORE);
    store.put(next, `${packId}::len`);
    for (const key of keys) {
      const text = String(key);
      if (!text.startsWith(mark)) continue;
      const index = Number(text.slice(mark.length));
      if (index > lastKeep) store.delete(key);
    }
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error || new Error('partial truncate failed'));
    tx.onabort = () => reject(tx.error || new Error('partial truncate aborted'));
  });
}

async function deletePartial(packId) {
  const keys = await partialKeys();
  const prefix = `${packId}::`;
  const doomed = keys.filter((key) => String(key).startsWith(prefix));
  if (!doomed.length) return;
  const db = await openPartialDb();
  await new Promise((resolve, reject) => {
    const tx = db.transaction(PARTIAL_STORE, 'readwrite');
    const store = tx.objectStore(PARTIAL_STORE);
    for (const key of doomed) store.delete(key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error || new Error('partial delete failed'));
    tx.onabort = () => reject(tx.error || new Error('partial delete aborted'));
  });
}

async function readPartial(packId, start, end) {
  const from = Math.max(0, start);
  const to = Math.max(from, end);
  const out = new Uint8Array(to - from);
  let filled = 0;
  while (filled < out.length) {
    const abs = from + filled;
    const index = Math.floor(abs / RESUME_REWIND_BYTES);
    const chunk = asBytes(await partialGet(`${packId}::c::${index}`));
    const within = abs - index * RESUME_REWIND_BYTES;
    if (within >= chunk.length) break;
    const n = Math.min(out.length - filled, chunk.length - within);
    out.set(chunk.subarray(within, within + n), filled);
    filled += n;
  }
  return filled === out.length ? out : out.subarray(0, filled);
}

async function readAllPartial(packId) {
  const n = await partialLength(packId);
  const bytes = await readPartial(packId, 0, n);
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
}

async function writeSlice(packId, offset, data) {
  if (!data?.length) return;
  const prev = await partialLength(packId);
  const db = await openPartialDb();
  const indexes = [];
  for (let pos = 0; pos < data.length;) {
    const index = Math.floor((offset + pos) / RESUME_REWIND_BYTES);
    indexes.push(index);
    const within = offset + pos - index * RESUME_REWIND_BYTES;
    pos += Math.min(data.length - pos, RESUME_REWIND_BYTES - within);
  }
  await new Promise((resolve, reject) => {
    const tx = db.transaction(PARTIAL_STORE, 'readwrite');
    const store = tx.objectStore(PARTIAL_STORE);
    const got = new Map();
    let pending = indexes.length;
    const fail = (err) => reject(err || new Error('partial write failed'));
    const commit = () => {
      try {
        let pos = 0;
        while (pos < data.length) {
          const index = Math.floor((offset + pos) / RESUME_REWIND_BYTES);
          const within = offset + pos - index * RESUME_REWIND_BYTES;
          const n = Math.min(data.length - pos, RESUME_REWIND_BYTES - within);
          const existing = got.get(index) || new Uint8Array(0);
          const mergedLen = Math.max(existing.length, within + n);
          const merged = new Uint8Array(mergedLen);
          if (existing.length) merged.set(existing.subarray(0, Math.min(existing.length, mergedLen)));
          merged.set(data.subarray(pos, pos + n), within);
          got.set(index, merged);
          store.put(merged, `${packId}::c::${index}`);
          pos += n;
        }
        const end = offset + data.length;
        if (end > prev) store.put(end, `${packId}::len`);
      } catch (err) {
        fail(err);
      }
    };
    for (const index of indexes) {
      const req = store.get(`${packId}::c::${index}`);
      req.onsuccess = () => {
        got.set(index, asBytes(req.result));
        pending -= 1;
        if (pending === 0) commit();
      };
      req.onerror = () => fail(req.error);
    }
    tx.oncomplete = () => resolve();
    tx.onerror = () => fail(tx.error);
    tx.onabort = () => fail(tx.error || new Error('partial write aborted'));
  });
}

function sleepMs(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted || userStop) {
      reject(new DOMException('Aborted', 'AbortError'));
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new DOMException('Aborted', 'AbortError'));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

function waitUntilOnline(signal) {
  if (typeof navigator === 'undefined' || navigator.onLine !== false) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const finish = () => {
      cleanup();
      resolve();
    };
    const onAbort = () => {
      cleanup();
      reject(new DOMException('Aborted', 'AbortError'));
    };
    const onOnline = () => {
      if (typeof navigator === 'undefined' || navigator.onLine !== false) finish();
    };
    const poll = setInterval(onOnline, 1000);
    function cleanup() {
      clearInterval(poll);
      window.removeEventListener('online', onOnline);
      signal?.removeEventListener('abort', onAbort);
    }
    window.addEventListener('online', onOnline);
    if (signal?.aborted || userStop) {
      onAbort();
      return;
    }
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

/** For media-feed retries when the NIC drops mid-download. */
export function waitForAppOnline(signal) {
  return waitUntilOnline(signal);
}

function readWithStall(reader, signal) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      reader.cancel().catch(() => {});
      const kind = (typeof navigator !== 'undefined' && navigator.onLine === false) ? 'offline' : 'stall';
      reject(attemptError('stalled', kind));
    }, STALL_MS);
    const onAbort = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reader.cancel().catch(() => {});
      reject(signal.reason || new DOMException('Aborted', 'AbortError'));
    };
    if (signal?.aborted) {
      onAbort();
      return;
    }
    signal?.addEventListener('abort', onAbort, { once: true });
    reader.read().then((result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      resolve(result);
    }, (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      reject(err);
    });
  });
}

function concatBytes(parts, length) {
  const out = new Uint8Array(length);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

function announcedTotal(res) {
  const range = res.headers.get('Content-Range') || '';
  const match = /\/(\d+)\s*$/.exec(range);
  if (match) {
    const total = Number(match[1]);
    if (total > 0) return total;
  }
  if (res.status === 200) {
    const length = Number(res.headers.get('Content-Length'));
    if (Number.isFinite(length) && length > 0) return length;
  }
  return 0;
}

function partialExpected(packId) {
  return partialGet(`${packId}::expect`).then((value) => {
    const n = Number(value);
    return Number.isFinite(n) && n > 0 ? n : 0;
  });
}

async function setPartialExpected(packId, n) {
  if (!(n > 0)) return;
  const db = await openPartialDb();
  await new Promise((resolve, reject) => {
    const tx = db.transaction(PARTIAL_STORE, 'readwrite');
    tx.objectStore(PARTIAL_STORE).put(n, `${packId}::expect`);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error || new Error('partial expect failed'));
    tx.onabort = () => reject(tx.error || new Error('partial expect aborted'));
  });
}

async function storePackBody(packId, url, expectedBytes, signal, onBytes) {
  let expected = expectedBytes > 0 ? expectedBytes : await partialExpected(packId);
  let size = await partialLength(packId);
  if (expected > 0 && size > expected) {
    await setPartialLength(packId, 0);
    size = 0;
  }
  if (expected > 0 && size === expected) {
    onBytes?.(size, expected);
    return;
  }
  const rewind = size > 0 ? Math.min(RESUME_REWIND_BYTES, size) : 0;
  let start = size - rewind;
  const headers = {};
  if (start > 0) headers.Range = `bytes=${start}-`;
  let res;
  try {
    res = await fetch(url, { signal, mode: 'cors', cache: 'no-store', headers });
  } catch (err) {
    if (err?.name === 'AbortError') throw err;
    const kind = (typeof navigator !== 'undefined' && navigator.onLine === false) ? 'offline' : 'http';
    throw attemptError(err?.message || 'pack fetch failed', kind, packId, false);
  }
  if (start > 0 && res.status === 200) {
    await setPartialLength(packId, 0);
    start = 0;
  } else if (start > 0 && res.status === 416) {
    throw attemptError('range not satisfiable', 'resume', packId, false);
  } else if (start > 0 && res.status !== 206) {
    throw attemptError(`pack ${res.status}`, res.ok ? 'resume' : 'http', packId, false);
  } else if (!res.ok) {
    throw attemptError(`pack ${res.status}`, 'http', packId, false);
  }
  if (!res.body) throw attemptError('pack has no body', 'http', packId, false);
  if (!(expectedBytes > 0)) {
    const announced = announcedTotal(res);
    if (announced > 0 && announced !== expected) {
      if (expected > 0 && start > 0) {
        throw attemptError('size changed', 'resume', packId, false);
      }
      expected = announced;
      await setPartialExpected(packId, announced);
    }
  }
  const overlap = start > 0 ? await readPartial(packId, start, size) : null;
  const reader = res.body.getReader();
  const pending = [];
  let pendingLen = 0;
  let confirmed = !overlap;
  let filePos = start;
  const sizeAtStart = size;
  try {
    while (true) {
      if (userStop) throw new DOMException('Aborted', 'AbortError');
      const { done, value } = await readWithStall(reader, signal);
      if (done) break;
      if (!value?.length) continue;
      if (!confirmed) {
        pending.push(value);
        pendingLen += value.length;
        if (overlap && pendingLen < overlap.length) continue;
        const all = concatBytes(pending, pendingLen);
        for (let i = 0; i < overlap.length; i++) {
          if (all[i] !== overlap[i]) {
            throw attemptError('resume overlap mismatch', 'resume', packId, false);
          }
        }
        await writeSlice(packId, start, all);
        filePos = start + all.length;
        confirmed = true;
        pending.length = 0;
      } else {
        await writeSlice(packId, filePos, value);
        filePos += value.length;
      }
      onBytes?.(filePos, expected);
    }
  } catch (err) {
    if (err?.name === 'DownloadAttemptError' && !err.packId) err.packId = packId;
    if (err?.name === 'QuotaExceededError') {
      throw attemptError(err.message || 'disk full', 'quota', packId, filePos > sizeAtStart);
    }
    if (err?.progressed == null && filePos > sizeAtStart) err.progressed = true;
    throw err;
  }
  if (!confirmed) {
    throw attemptError('truncated before resume check', 'stall', packId, false);
  }
  if (expected > 0 && filePos !== expected) {
    if (filePos > expected) await setPartialLength(packId, 0);
    throw attemptError('truncated pack', 'stall', packId, filePos > sizeAtStart && filePos <= expected);
  }
  const prev = await partialLength(packId);
  if (filePos < prev) await setPartialLength(packId, filePos);
}

async function cacheZipEntry(cache, entryName, fileBytes, cachedSet) {
  const path = String(entryName || '').replace(/\\/g, '/').replace(/^\/+/, '');
  const slash = path.indexOf('/');
  if (slash < 1) return null;
  const folder = path.slice(0, slash);
  const file = path.slice(slash + 1);
  if ((folder !== 'img' && folder !== 'vid') || !file || file.endsWith('/')) return null;
  const mediaType = folder === 'vid' ? 'video' : 'image';
  if (nameInCachedSet(file, cachedSet, mediaType)) return file;
  const type = mediaMime(file);
  const blob = new Blob([fileBytes], { type });
  if (!mediaCacheIsPersistent()) {
    const url = getMediaUrls(file, mediaType)[0];
    if (!url) return null;
    await storeMediaBlob(url, blob);
    addMediaCacheKeys(cachedSet, url);
    cachedSet.add(file);
    return file;
  }
  for (const url of getMediaUrls(file, mediaType)) {
    const request = new Request(url, { mode: /^https?:\/\//i.test(url) ? 'cors' : 'same-origin' });
    await cache.put(request, new Response(blob, { headers: { 'Content-Type': type } }));
    addMediaCacheKeys(cachedSet, url);
  }
  cachedSet.add(file);
  invalidateOfflineMediaKeys();
  return file;
}

function nameInCachedSet(name, cachedSet, mediaType) {
  if (!name || !cachedSet) return false;
  if (cachedSet.has(name)) return true;
  try {
    if (cachedSet.has(decodeURIComponent(name))) return true;
  } catch { /* keep encoded */ }
  const kind = mediaType || (/\.mp4$|\.webm$/i.test(name) ? 'video' : 'image');
  for (const url of getMediaUrls(name, kind)) {
    const keys = new Set();
    addMediaCacheKeys(keys, url);
    for (const key of keys) {
      if (cachedSet.has(key)) return true;
    }
  }
  return false;
}

function mediaFileNameFromUrl(url) {
  try {
    const path = new URL(url, typeof location !== 'undefined' ? location.href : 'https://example.invalid/').pathname;
    const file = path.split('/').pop() || '';
    try { return decodeURIComponent(file); } catch { return file; }
  } catch {
    const file = String(url || '').split('/').pop() || '';
    try { return decodeURIComponent(file); } catch { return file; }
  }
}

function mediaNamesFromUrls(urls) {
  const names = new Set();
  for (const url of urls || []) {
    const name = mediaFileNameFromUrl(url);
    if (name) names.add(name);
  }
  return names;
}

function packNamesList(pack) {
  if (!pack || !Array.isArray(pack.names) || !pack.names.length) return null;
  return pack.names.map((n) => String(n));
}

function packAllNamesInCache(names, cachedSet) {
  if (!names || !names.length) return false;
  for (const name of names) {
    if (!nameInCachedSet(name, cachedSet)) return false;
  }
  return true;
}

/** True when every file of the pack is already local (by manifest names or prior unpack). */
function packFilesCached(pack, doneMap, cachedSet) {
  const listed = packNamesList(pack);
  if (listed && packAllNamesInCache(listed, cachedSet)) return true;
  const prev = doneMap[pack.id];
  if (!prev || String(prev.sha256 || '') !== String(pack.sha256 || '')) return false;
  if (!Array.isArray(prev.names) || !prev.names.length) return false;
  return packAllNamesInCache(prev.names, cachedSet);
}

/** Align packsDone with a pack whose files are already in cache (new sha / repartition). */
function syncPackDoneFromCache(pack, doneMap, cachedSet) {
  const listed = packNamesList(pack);
  if (!listed || !packAllNamesInCache(listed, cachedSet)) return false;
  const prev = doneMap[pack.id];
  const sameHash = prev && String(prev.sha256 || '') === String(pack.sha256 || '');
  const sameNames = prev && Array.isArray(prev.names)
    && prev.names.length === listed.length
    && listed.every((n, i) => prev.names[i] === n);
  if (sameHash && sameNames) return false;
  doneMap[pack.id] = { sha256: pack.sha256 || '', names: listed };
  return true;
}

function basenameFromCacheKey(key) {
  const raw = String(key || '');
  try {
    const u = new URL(raw, typeof location !== 'undefined' ? location.href : 'https://example.invalid/');
    const m = u.pathname.match(/\/(?:vid|img)\/([^/]+)$/i);
    const file = m ? m[1] : (u.pathname.split('/').pop() || '');
    try { return decodeURIComponent(file); } catch { return file; }
  } catch {
    const file = raw.split('/').pop() || raw;
    try { return decodeURIComponent(file); } catch { return file; }
  }
}

async function removeOfflineMediaNamed(namesToRemove) {
  if (!namesToRemove || !namesToRemove.size) return;
  const want = new Set();
  for (const name of namesToRemove) {
    const n = String(name || '');
    if (!n) continue;
    want.add(n);
    want.add(n.toLowerCase());
    try { want.add(decodeURIComponent(n)); } catch { /* keep raw */ }
    try { want.add(decodeURIComponent(n).toLowerCase()); } catch { /* keep raw */ }
  }
  if (!want.size) return;

  const cache = await openOfflineCache();
  if (cache) {
    try {
      const keys = await cache.keys();
      for (const req of keys) {
        const base = basenameFromCacheKey(req.url);
        if (want.has(base) || want.has(base.toLowerCase())) {
          try { await cache.delete(req); } catch { /* keep going */ }
        }
      }
    } catch { /* Cache Storage missing */ }
  }
  try {
    const tails = await idbKeys();
    for (const key of tails) {
      const base = basenameFromCacheKey(key);
      const file = String(key).split('/').pop() || '';
      if (want.has(base) || want.has(base.toLowerCase())
        || want.has(file) || want.has(file.toLowerCase())) {
        try { await idbDelete(key); } catch { /* keep going */ }
      }
    }
  } catch { /* IndexedDB unavailable */ }
  invalidateOfflineMediaKeys();
  notifyServiceWorkerOfflineMedia();
}

/** Drop files that used to belong to this category offline but are gone from needed. */
async function pruneCategoryOfflineOrphans(orphanCandidates, neededUrls) {
  const needed = mediaNamesFromUrls(neededUrls);
  const toRemove = new Set();
  for (const name of orphanCandidates || []) {
    if (name && !needed.has(name)) toRemove.add(name);
  }
  await removeOfflineMediaNamed(toRemove);
}

function clamp01(n) {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

/**
 * One bar for download + unpack. `floorPct` is coverage already on disk.
 * Each pending pack is a slice of the remaining %, half download / half unpack.
 */
export function combinedPackProgress(floorPct, packWeights, packIndex, downloadFrac, unpackFrac) {
  const floor = Math.max(0, Math.min(100, Number(floorPct) || 0));
  const weights = (packWeights || []).map((w) => Math.max(1, Number(w) || 0));
  if (!weights.length) return floor;
  const totalW = weights.reduce((sum, w) => sum + w, 0);
  let doneW = 0;
  for (let i = 0; i < packIndex; i++) doneW += weights[i] || 0;
  const curW = weights[packIndex] || 0;
  const packFrac = 0.5 * clamp01(downloadFrac) + 0.5 * clamp01(unpackFrac);
  return floor + ((100 - floor) * (doneW + curW * packFrac)) / totalW;
}

async function finishCategoryDownload(categoryId, mediaUrls, cancelled, failed, stopped = false, orphanCandidates = null) {
  const downloaded = getDownloadedCategories();
  const manifest = loadManifest();
  const previous = Array.isArray(manifest[categoryId]) ? manifest[categoryId] : [];
  const orphans = new Set(orphanCandidates || []);
  for (const name of mediaNamesFromUrls(previous)) orphans.add(name);
  if (!cancelled && failed === 0) {
    downloaded.add(categoryId);
    manifest[categoryId] = mediaUrls;
  } else {
    downloaded.delete(categoryId);
    delete manifest[categoryId];
  }
  saveDownloaded(downloaded);
  saveManifest(manifest);
  if (!cancelled || stopped) clearInProgressOfflineCategory(categoryId);
  if (!cancelled && failed === 0) {
    await pruneCategoryOfflineOrphans(orphans, mediaUrls);
  }
  notifyServiceWorkerOfflineMedia();
  return {
    success: !cancelled && failed === 0,
    total: mediaUrls.length,
    failed,
    cancelled,
    stopped,
  };
}

function retryDelay(err, streak) {
  if (err?.progressed) return QUICK_RETRY_MS;
  return Math.min(RETRY_MAX_MS, RETRY_BASE_MS * (2 ** Math.min(streak, 4)));
}

function isOfflineFailure(err) {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return true;
  return err?.kind === 'offline';
}

async function runPackDownload(categoryId, onProgress, signal) {
  await loadLocalConfig();
  const data = await fetchCategoryMediaList(categoryId);
  const mediaUrls = getCategoryMediaUrls(data);
  if (mediaUrls.length === 0) {
    onProgress?.(1, 1);
    return { done: true, mediaUrls };
  }

  let man;
  try {
    man = await fetchPacksManifest(signal);
  } catch (err) {
    if (err?.name === 'AbortError') throw err;
    const kind = (typeof navigator !== 'undefined' && navigator.onLine === false) ? 'offline' : 'http';
    throw attemptError(err?.message || 'manifest failed', kind, '', false);
  }
  const packIds = man.categories?.[categoryId];
  if (!Array.isArray(packIds) || packIds.length === 0) {
    throw attemptError(`No packs listed for ${categoryId}`, 'http', '', false);
  }
  const packs = packIds.map((id) => man.packs?.[id]).filter(Boolean);
  if (!packs.length) throw attemptError(`Pack metadata missing for ${categoryId}`, 'http', '', false);

  const cache = typeof caches !== 'undefined' ? await caches.open(OFFLINE_CACHE) : null;
  if (!cache) throw attemptError('Cache Storage is not available', 'quota', '', false);
  const doneMap = loadPacksDone();
  const cached = await getCachedUrlSet();
  let packsDoneDirty = false;
  for (const pack of packs) {
    if (syncPackDoneFromCache(pack, doneMap, cached)) packsDoneDirty = true;
  }
  if (packsDoneDirty) savePacksDone(doneMap);

  // Orphans = prior manifest for THIS category only. Do not add packsDone
  // names: shared zips list files for other categories too, and pruning
  // against this category's needed set would delete their offline copies.
  const orphanCandidates = new Set(mediaNamesFromUrls(loadManifest()[categoryId] || []));

  const cov = coverageFromUrls(mediaUrls, cached);
  if (cov.pct >= 100) {
    onProgress?.(100, 100, { failed: 0, cancelled: false });
    return { done: true, mediaUrls, orphanCandidates };
  }

  const pending = packs
    .filter((pack) => !packFilesCached(pack, doneMap, cached))
    .sort((a, b) => (Number(a.bytes) || 0) - (Number(b.bytes) || 0));
  const packWeights = pending.map((pack) => Number(pack.bytes) || 0);
  const floorPct = cov.pct;
  const reportJob = (packIndex, downloadFrac, unpackFrac, finished = false) => {
    let pct = combinedPackProgress(floorPct, packWeights, packIndex, downloadFrac, unpackFrac);
    if (finished) pct = 100;
    let n = Math.round(pct);
    n = Math.max(0, Math.min(100, n));
    if (!finished && n >= 100) n = 99;
    onProgress?.(n, 100, { failed: 0, cancelled: false });
  };
  reportJob(0, 0, 0);
  if (!pending.length) {
    reportJob(0, 1, 1, true);
    return { done: true, mediaUrls, orphanCandidates };
  }

  for (let packIndex = 0; packIndex < pending.length; packIndex++) {
    const pack = pending[packIndex];
    if (userStop) throw new DOMException('Aborted', 'AbortError');
    if (signal.aborted) throw attemptError('aborted', 'stall', pack.id, false);
    if (coverageFromUrls(mediaUrls, cached).pct >= 100) {
      reportJob(packIndex, 1, 1, true);
      return { done: true, mediaUrls, orphanCandidates };
    }
    if (packFilesCached(pack, doneMap, cached)) {
      try { await deletePartial(pack.id); } catch { /* zip already unpacked */ }
      continue;
    }
    const zipUrl = `${packsBaseUrl()}/${pack.file || `${pack.id}.zip`}`;
    const expectedBytes = Math.max(Number(pack.bytes) || 0, 1);
    try {
      await storePackBody(pack.id, zipUrl, expectedBytes, signal, (loaded) => {
        reportJob(packIndex, loaded / expectedBytes, 0);
      });
    } catch (err) {
      if (err && !err.packId) err.packId = pack.id;
      throw err;
    }
    reportJob(packIndex, 1, 0);
    const buffer = await readAllPartial(pack.id);
    if (pack.sha256) {
      const hex = await sha256hex(buffer);
      if (hex !== String(pack.sha256).toLowerCase()) {
        throw attemptError(`Pack hash mismatch ${pack.file}`, 'hash', pack.id, false);
      }
    }
    const names = [];
    await forEachZipFile(buffer, async (entryName, fileBytes) => {
      if (userStop) throw new DOMException('Aborted', 'AbortError');
      const stored = await cacheZipEntry(cache, entryName, fileBytes, cached);
      if (stored) names.push(stored);
    }, (done, total) => {
      reportJob(packIndex, 1, total > 0 ? done / total : 1);
    });
    if (userStop) throw new DOMException('Aborted', 'AbortError');
    doneMap[pack.id] = { sha256: pack.sha256 || '', names };
    savePacksDone(doneMap);
    try { await deletePartial(pack.id); } catch { /* unpacked copy is the one that matters */ }
    reportJob(packIndex, 1, 1);
  }
  reportJob(Math.max(0, pending.length - 1), 1, 1, true);
  return { done: true, mediaUrls, orphanCandidates };
}

export async function downloadCategoryMediaFromPacks(categoryId, onProgress) {
  const resumeFails = new Map();
  let streak = 0;
  let mediaUrls = [];
  let orphanCandidates = null;
  while (!userStop) {
    const controller = new AbortController();
    activeController = controller;
    try {
      const pass = await runPackDownload(categoryId, onProgress, controller.signal);
      mediaUrls = pass.mediaUrls;
      orphanCandidates = pass.orphanCandidates || orphanCandidates;
      if (pass.done) {
        return finishCategoryDownload(categoryId, mediaUrls, false, 0, false, orphanCandidates);
      }
    } catch (err) {
      if (userStop) break;
      if (isOfflineFailure(err)) {
        try { await waitUntilOnline(controller.signal); }
        catch { if (userStop) break; }
        continue;
      }
      if (err?.kind === 'resume' && err.packId) {
        const n = (resumeFails.get(err.packId) || 0) + 1;
        resumeFails.set(err.packId, n);
        if (n >= REAL_ERRORS_BEFORE_RESTART) {
          try { await deletePartial(err.packId); } catch { /* next pass starts clean */ }
          resumeFails.set(err.packId, 0);
        }
      } else if (err?.kind === 'hash' && err.packId) {
        try { await deletePartial(err.packId); } catch { /* next pass starts clean */ }
      }
      const delay = retryDelay(err, streak);
      if (err?.progressed) streak = 0;
      else streak += 1;
      try { await sleepMs(delay, controller.signal); }
      catch { if (userStop) break; }
    } finally {
      if (activeController === controller) activeController = null;
    }
  }
  return finishCategoryDownload(categoryId, mediaUrls, true, 0, true, orphanCandidates);
}

function isSameOriginMediaUrl(url) {
  try {
    const abs = new URL(url, typeof location !== 'undefined' ? location.href : undefined);
    return typeof location !== 'undefined' && abs.origin === location.origin;
  } catch {
    return false;
  }
}

function mediaPartialKey(url) {
  let path = String(url || '');
  try {
    path = new URL(url, typeof location !== 'undefined' ? location.href : 'https://example.invalid/').pathname;
  } catch { /* keep the raw string */ }
  return `file_${path.replace(/[^a-zA-Z0-9._-]+/g, '_').replace(/^_+/, '')}`;
}

async function storeResumableMedia(url, signal, onFraction) {
  const key = mediaPartialKey(url);
  const href = new URL(url, location.href).href;
  await storePackBody(key, href, 0, signal, (loaded, known) => {
    const frac = known > 0 ? Math.min(0.999, loaded / known) : 0;
    onFraction?.(frac);
  });
  const bytes = await readAllPartial(key);
  const type = mediaMime(href);
  await storeMediaBlob(href, new Blob([bytes], { type }));
  try { await deletePartial(key); } catch { /* playback copy is already stored */ }
}

async function storeWholeMedia(url, signal) {
  const request = getMediaRequest(url);
  const response = await fetchMediaResponse(request, signal);
  if (response.type === 'opaque') {
    if (!mediaCacheIsPersistent()) throw attemptError('opaque media needs a secure origin', 'http', '', false);
    const cache = await openOfflineCache();
    if (!cache) throw attemptError('opaque media needs Cache Storage', 'quota', '', false);
    await cache.put(request, response.clone());
    invalidateOfflineMediaKeys();
    return request.url;
  }
  if (!response.ok) {
    const kind = (typeof navigator !== 'undefined' && navigator.onLine === false) ? 'offline' : 'http';
    throw attemptError(`media ${response.status}`, kind, '', false);
  }
  const blob = await response.blob();
  await storeMediaBlob(url, blob);
  return request.url;
}

async function runFileDownload(categoryId, onProgress, signal) {
  await loadLocalConfig();
  const data = await fetchCategoryMediaList(categoryId);
  const mediaUrls = getCategoryMediaUrls(data);
  const total = mediaUrls.length;
  if (total === 0) {
    onProgress?.(1, 1);
    return { done: true, mediaUrls };
  }
  const cached = await getCachedUrlSet();
  const pending = mediaUrls.filter((url) => !urlIsCached(url, cached));
  let completed = total - pending.length;
  onProgress?.(completed, total, { failed: 0, cancelled: false });

  for (let i = 0; i < pending.length;) {
    if (userStop) throw new DOMException('Aborted', 'AbortError');
    if (signal.aborted) throw attemptError('aborted', 'stall', '', completed > 0);
    const url = pending[i];
    if (isSameOriginMediaUrl(url)) {
      await storeResumableMedia(url, signal, (frac) => {
        onProgress?.(completed + frac, total, { failed: 0, cancelled: false });
      });
      addMediaCacheKeys(cached, url);
      addMediaCacheKeys(cached, new URL(url, location.href).href);
      completed += 1;
      i += 1;
      onProgress?.(completed, total, { failed: 0, cancelled: false });
      continue;
    }
    const batch = pending.slice(i, i + BATCH_SIZE).filter((item) => !isSameOriginMediaUrl(item));
    await Promise.all(batch.map(async (item) => {
      const storedUrl = await storeWholeMedia(item, signal);
      addMediaCacheKeys(cached, item);
      addMediaCacheKeys(cached, storedUrl);
    }));
    completed += batch.length;
    i += batch.length;
    onProgress?.(completed, total, { failed: 0, cancelled: false });
  }
  return { done: true, mediaUrls };
}

export async function downloadCategoryMediaFromFiles(categoryId, onProgress) {
  const resumeFails = new Map();
  let mediaUrls = [];
  let streak = 0;
  while (!userStop) {
    const controller = new AbortController();
    activeController = controller;
    try {
      const pass = await runFileDownload(categoryId, onProgress, controller.signal);
      mediaUrls = pass.mediaUrls;
      if (pass.done) return finishCategoryDownload(categoryId, mediaUrls, false, 0, false);
    } catch (err) {
      if (userStop) break;
      if (isOfflineFailure(err)) {
        try { await waitUntilOnline(controller.signal); }
        catch { if (userStop) break; }
        continue;
      }
      if (err?.kind === 'resume' && err.packId) {
        const n = (resumeFails.get(err.packId) || 0) + 1;
        resumeFails.set(err.packId, n);
        if (n >= REAL_ERRORS_BEFORE_RESTART) {
          try { await deletePartial(err.packId); } catch { /* next pass starts clean */ }
          resumeFails.set(err.packId, 0);
        }
      }
      const delay = retryDelay(err, streak);
      if (err?.progressed) streak = 0;
      else streak += 1;
      try { await sleepMs(delay, controller.signal); }
      catch { if (userStop) break; }
    } finally {
      if (activeController === controller) activeController = null;
    }
  }
  return finishCategoryDownload(categoryId, mediaUrls, true, 0, true);
}

async function categoryIdsForReconcile() {
  const downloaded = getDownloadedCategories();
  const manifest = loadManifest();
  const ids = new Set([...downloaded, ...Object.keys(manifest)]);
  try {
    const meta = await fetchMeta();
    for (const cat of meta?.categories || []) {
      if (cat?.id) ids.add(cat.id);
    }
  } catch { /* listed + downloaded is enough */ }
  return [...ids];
}

export async function reconcileDownloadedCategories() {
  await loadLocalConfig();
  const downloaded = getDownloadedCategories();
  const manifest = loadManifest();
  if (usesLocalMedia() && isLoopbackHost()) return downloaded;

  const ids = await categoryIdsForReconcile();
  if (!ids.length) return downloaded;

  const cached = await getCachedUrlSet();
  let changed = false;
  const inProgress = getInProgressOfflineCategory();
  const tracked = new Set([...downloaded]);
  if (inProgress) tracked.add(inProgress);
  for (const id of Object.keys(manifest)) tracked.add(id);

  let packsMan = null;
  let doneMap = null;
  if (OFFLINE_DOWNLOAD === 'packs') {
    try {
      packsMan = await fetchPacksManifest();
      doneMap = loadPacksDone();
      const knownPackIds = new Set(Object.keys(packsMan?.packs || {}));
      let packsDirty = false;
      for (const id of Object.keys(doneMap)) {
        if (!knownPackIds.has(id)) {
          delete doneMap[id];
          packsDirty = true;
          changed = true;
        }
      }
      if (packsDirty) savePacksDone(doneMap);
    } catch {
      packsMan = null;
      doneMap = loadPacksDone();
    }
  }

  for (const categoryId of ids) {
    const previousListed = Array.isArray(manifest[categoryId]) ? manifest[categoryId] : null;
    let mediaUrls;
    try {
      mediaUrls = getCategoryMediaUrls(await fetchCategoryMediaList(categoryId));
    } catch {
      continue;
    }

    // Same rule as pack download finish: only this category's prior manifest
    // URLs are orphan candidates. Shared pack name lists must not be pruned
    // against one category's needed set.
    const orphanCandidates = new Set(mediaNamesFromUrls(previousListed || []));
    if (packsMan && doneMap) {
      const packIds = packsMan.categories?.[categoryId];
      if (Array.isArray(packIds)) {
        let packsDirty = false;
        for (const packId of packIds) {
          const pack = packsMan.packs?.[packId];
          if (!pack) continue;
          if (syncPackDoneFromCache(pack, doneMap, cached)) {
            packsDirty = true;
            changed = true;
          }
        }
        if (packsDirty) savePacksDone(doneMap);
      }
    }

    const complete = coverageFromUrls(mediaUrls, cached).pct >= 100;
    const was = downloaded.has(categoryId);
    if (complete) {
      if (!was) changed = true;
      downloaded.add(categoryId);
      const listedSame = previousListed
        && previousListed.length === mediaUrls.length
        && previousListed.every((u, i) => u === mediaUrls[i]);
      if (!listedSame) {
        manifest[categoryId] = mediaUrls;
        changed = true;
      }
      if (tracked.has(categoryId) && orphanCandidates.size) {
        await pruneCategoryOfflineOrphans(orphanCandidates, mediaUrls);
      }
    } else if (was || previousListed) {
      downloaded.delete(categoryId);
      delete manifest[categoryId];
      changed = true;
      if (tracked.has(categoryId) && orphanCandidates.size) {
        // Keep files still needed by the new JSON; drop only true orphans.
        await pruneCategoryOfflineOrphans(orphanCandidates, mediaUrls);
      }
    }
  }

  if (changed) {
    saveDownloaded(downloaded);
    saveManifest(manifest);
  }

  return downloaded;
}
