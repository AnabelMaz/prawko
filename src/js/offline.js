// offline.js — Offline download management

import { fetchMeta, fetchCategory, getMediaUrls, usesLocalMedia, isLoopbackHost, PACKS_BASE, OFFLINE_DOWNLOAD } from './data.js';
import { forEachZipFile } from './zip.js';

const DOWNLOAD_KEY = 'prawko_offline';
const MANIFEST_KEY = 'prawko_offline_manifest';
const PACKS_DONE_KEY = 'prawko_offline_packs';
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

async function openOfflineCache() {
  if (!mediaCacheIsPersistent()) return null;
  if (typeof caches === 'undefined') return null;
  try {
    return await caches.open(OFFLINE_CACHE);
  } catch {
    return null;
  }
}

function openMediaDb() {
  return new Promise((resolve, reject) => {
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
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error('IndexedDB open failed'));
  });
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
    const closeDb = () => {
      try { db.close(); } catch { /* already closed */ }
    };
    const fail = (err) => {
      if (settled) return;
      settled = true;
      closeDb();
      reject(err);
    };
    const tryFinish = () => {
      if (settled || !txDone || !copyDone) return;
      settled = true;
      closeDb();
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

function idbKeys() {
  return idbRequest('readonly', (store) => store.getAllKeys()).then((keys) => keys || []);
}

async function clonePlayableBlob(value, name) {
  if (!value) return null;
  const type = (value.type && String(value.type)) || mediaMime(name) || 'application/octet-stream';
  if (value instanceof Blob) {
    if (value.size < 1) return null;
    const buf = await value.arrayBuffer();
    if (!buf.byteLength) return null;
    return new Blob([buf], { type });
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
    keys = await idbKeys();
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
  const body = blob.type === type ? blob : new Blob([await blob.arrayBuffer()], { type });
  const abs = new URL(url, typeof location !== 'undefined' ? location.href : 'https://example.invalid/').href;
  const tail = mediaPathTail(abs);
  const cache = await openOfflineCache();
  if (cache) {
    try {
      await cache.put(new Request(abs), new Response(body, {
        status: 200,
        headers: {
          'Content-Type': type,
          'Content-Length': String(body.size),
        },
      }));
      return;
    } catch {
      /* Cache Storage can exist but reject puts; keep going to IndexedDB. */
    }
  }
  if (!tail) throw new Error('no media storage');
  await idbPut(tail, body);
}

async function matchCachedMediaResponse(cache, media, mediaType) {
  const urls = getMediaUrls(media, mediaType);
  const opts = { ignoreSearch: true, ignoreVary: true };
  for (const url of urls) {
    try {
      const abs = new URL(url, location.href).href;
      const hit = await cache.match(abs, opts)
        || await cache.match(new Request(abs), opts)
        || await cache.match(new Request(abs, { mode: 'cors' }), opts)
        || await cache.match(new Request(abs, { mode: 'no-cors' }), opts);
      if (hit) return hit;
    } catch { /* try next alias */ }
  }
  const { names, tails } = idbKeyCandidates(media, mediaType);
  let keys = [];
  try {
    keys = await cache.keys();
  } catch {
    return null;
  }
  for (const req of keys) {
    const tail = mediaPathTail(req.url);
    const file = String(req.url).split('/').pop() || '';
    let decoded = file;
    try { decoded = decodeURIComponent(file); } catch { /* keep encoded */ }
    const match = (tail && tails.has(tail))
      || names.has(file)
      || names.has(file.toLowerCase())
      || names.has(decoded)
      || names.has(decoded.toLowerCase());
    if (!match) continue;
    try {
      const hit = await cache.match(req, opts) || await cache.match(req);
      if (hit) return hit;
    } catch { /* try next key */ }
  }
  return null;
}

export async function getStoredMediaBlob(media, mediaType) {
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
    const keys = new Set();
    addMediaCacheKeys(keys, url);
    let hit = false;
    for (const key of keys) {
      if (cachedSet.has(key)) {
        hit = true;
        break;
      }
    }
    if (hit) have++;
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
  const ids = Array.isArray(categoryIds) ? categoryIds : [];
  const map = {};
  if (usesLocalMedia() && isLoopbackHost()) {
    for (const id of ids) map[id] = { have: 1, total: 1, pct: 100 };
    return map;
  }
  const cached = await getCachedUrlSet();
  await Promise.all(ids.map(async (id) => {
    try {
      const data = await fetchCategory(id);
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

export function cancelDownload() {
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
  if (activeDownload?.promise && activeDownload.categoryId === categoryId) {
    attachDownloadProgress(categoryId, onProgress);
    return activeDownload.promise;
  }
  cancelDownload();
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

async function fetchZipBytes(url, signal, onBytes) {
  const res = await fetch(url, { signal, mode: 'cors', cache: 'no-store' });
  if (!res.ok) throw new Error(`Pack ${res.status} ${url}`);
  if (!res.body || !onBytes) return res.arrayBuffer();
  const reader = res.body.getReader();
  const chunks = [];
  let loaded = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    loaded += value.byteLength;
    onBytes(loaded);
  }
  const out = new Uint8Array(loaded);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out.buffer;
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

function packFilesCached(pack, doneMap, cachedSet) {
  const prev = doneMap[pack.id];
  if (!prev || String(prev.sha256 || '') !== String(pack.sha256 || '')) return false;
  if (!Array.isArray(prev.names) || !prev.names.length) return false;
  for (const name of prev.names) {
    if (!nameInCachedSet(name, cachedSet)) return false;
  }
  return true;
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

function finishCategoryDownload(categoryId, mediaUrls, cancelled, failed) {
  const downloaded = getDownloadedCategories();
  const manifest = loadManifest();
  if (!cancelled && failed === 0) downloaded.add(categoryId);
  else downloaded.delete(categoryId);
  if (!cancelled && failed === 0) manifest[categoryId] = mediaUrls;
  else delete manifest[categoryId];
  saveDownloaded(downloaded);
  saveManifest(manifest);
  notifyServiceWorkerOfflineMedia();
  return { success: !cancelled && failed === 0, total: mediaUrls.length, failed, cancelled };
}

export async function downloadCategoryMediaFromPacks(categoryId, onProgress) {
  cancelDownload();
  const controller = new AbortController();
  activeController = controller;

  const data = await fetchCategory(categoryId);
  const mediaUrls = getCategoryMediaUrls(data);
  if (mediaUrls.length === 0) {
    activeController = null;
    onProgress?.(1, 1);
    return finishCategoryDownload(categoryId, [], false, 0);
  }

  let cancelled = false;
  let failed = 0;
  try {
    const man = await fetchPacksManifest(controller.signal);
    const packIds = man.categories?.[categoryId];
    if (!Array.isArray(packIds) || packIds.length === 0) {
      throw new Error(`No packs listed for ${categoryId}`);
    }
    const packs = packIds.map((id) => man.packs?.[id]).filter(Boolean);
    if (!packs.length) throw new Error(`Pack metadata missing for ${categoryId}`);

    const cache = typeof caches !== 'undefined' ? await caches.open(OFFLINE_CACHE) : null;
    if (!cache) throw new Error('Cache Storage is not available');
    const doneMap = loadPacksDone();
    const cached = await getCachedUrlSet();
    const cov = coverageFromUrls(mediaUrls, cached);
    if (cov.pct >= 100) {
      onProgress?.(100, 100, { failed, cancelled });
      return finishCategoryDownload(categoryId, mediaUrls, false, 0);
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
      onProgress?.(n, 100, { failed, cancelled });
    };
    reportJob(0, 0, 0);

    for (let packIndex = 0; packIndex < pending.length; packIndex++) {
      const pack = pending[packIndex];
      if (controller.signal.aborted) {
        cancelled = true;
        break;
      }
      if (coverageFromUrls(mediaUrls, cached).pct >= 100) {
        reportJob(packIndex, 1, 1, true);
        break;
      }
      const zipUrl = `${packsBaseUrl()}/${pack.file || `${pack.id}.zip`}`;
      const expectedBytes = Math.max(Number(pack.bytes) || 0, 1);
      const buffer = await fetchZipBytes(zipUrl, controller.signal, (loaded) => {
        reportJob(packIndex, loaded / expectedBytes, 0);
      });
      reportJob(packIndex, 1, 0);
      if (pack.sha256) {
        const hex = await sha256hex(buffer);
        if (hex !== String(pack.sha256).toLowerCase()) {
          throw new Error(`Pack hash mismatch ${pack.file}`);
        }
      }
      const names = [];
      await forEachZipFile(buffer, async (entryName, fileBytes) => {
        if (controller.signal.aborted) return;
        const stored = await cacheZipEntry(cache, entryName, fileBytes, cached);
        if (stored) names.push(stored);
      }, (done, total) => {
        reportJob(packIndex, 1, total > 0 ? done / total : 1);
      });
      reportJob(packIndex, 1, 1);
      if (controller.signal.aborted) {
        cancelled = true;
        break;
      }
      doneMap[pack.id] = { sha256: pack.sha256 || '', names };
      savePacksDone(doneMap);
    }
    if (!cancelled) reportJob(Math.max(0, pending.length - 1), 1, 1, true);
  } catch (err) {
    if (err?.name === 'AbortError') cancelled = true;
    else {
      failed = 1;
      throw err;
    }
  } finally {
    if (activeController === controller) activeController = null;
  }

  return finishCategoryDownload(categoryId, mediaUrls, cancelled, failed);
}

export async function downloadCategoryMediaFromFiles(categoryId, onProgress) {
  cancelDownload();
  const controller = new AbortController();
  activeController = controller;

  const data = await fetchCategory(categoryId);
  const mediaUrls = getCategoryMediaUrls(data);

  const total = mediaUrls.length;
  if (total === 0) {
    activeController = null;
    onProgress?.(1, 1);
    return finishCategoryDownload(categoryId, [], false, 0);
  }

  const cached = await getCachedUrlSet();
  const pending = mediaUrls.filter((url) => !urlIsCached(url, cached));
  let completed = total - pending.length;
  let failed = 0;
  let cancelled = false;
  onProgress?.(completed, total, { failed, cancelled });

  for (let i = 0; i < pending.length; i += BATCH_SIZE) {
    if (controller.signal.aborted) {
      cancelled = true;
      break;
    }

    const batch = pending.slice(i, i + BATCH_SIZE);
    const results = await Promise.allSettled(batch.map(async (url) => {
      const request = getMediaRequest(url);
      const response = await fetchMediaResponse(request, controller.signal);
      if (response.type === 'opaque') {
        if (!mediaCacheIsPersistent()) throw new Error('opaque media needs a secure origin');
        const cache = await openOfflineCache();
        if (!cache) throw new Error('opaque media needs Cache Storage');
        await cache.put(request, response.clone());
      } else {
        if (!response.ok) throw new Error(`media ${response.status}`);
        const blob = await response.blob();
        await storeMediaBlob(url, blob);
      }
      addMediaCacheKeys(cached, url);
      addMediaCacheKeys(cached, request.url);
    }));

    for (const r of results) {
      if (r.status === 'fulfilled') {
        completed++;
      } else if (r.reason?.name === 'AbortError' && controller.signal.aborted) {
        cancelled = true;
      } else {
        failed++;
        completed++;
      }
    }

    onProgress?.(completed, total, { failed, cancelled });

    if (cancelled) break;
  }

  if (activeController === controller) {
    activeController = null;
  }

  return finishCategoryDownload(categoryId, mediaUrls, cancelled, failed);
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
  const downloaded = getDownloadedCategories();
  const manifest = loadManifest();
  if (usesLocalMedia() && isLoopbackHost()) return downloaded;

  const ids = await categoryIdsForReconcile();
  if (!ids.length) return downloaded;

  const cached = await getCachedUrlSet();
  let changed = false;

  for (const categoryId of ids) {
    const listed = Array.isArray(manifest[categoryId]) ? manifest[categoryId] : null;
    let mediaUrls = listed;
    if (!mediaUrls) {
      try {
        mediaUrls = getCategoryMediaUrls(await fetchCategory(categoryId));
      } catch {
        continue;
      }
    }
    const complete = coverageFromUrls(mediaUrls, cached).pct >= 100;
    const was = downloaded.has(categoryId);
    if (complete) {
      if (!was) changed = true;
      downloaded.add(categoryId);
      if (!listed) {
        manifest[categoryId] = mediaUrls;
        changed = true;
      }
    } else if (was || listed) {
      downloaded.delete(categoryId);
      delete manifest[categoryId];
      changed = true;
    }
  }

  if (changed) {
    saveDownloaded(downloaded);
    saveManifest(manifest);
  }

  return downloaded;
}
