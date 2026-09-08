// offline.js — Offline download management

import { fetchCategory, getMediaUrls, usesLocalMedia, PACKS_BASE, OFFLINE_DOWNLOAD } from './data.js';
import { forEachZipFile } from './zip.js';

const DOWNLOAD_KEY = 'prawko_offline';
const MANIFEST_KEY = 'prawko_offline_manifest';
const PACKS_DONE_KEY = 'prawko_offline_packs';
const OFFLINE_CACHE = 'prawko-offline-media-v1';
const BATCH_SIZE = 6;

function getMediaRequest(url) {
  return new Request(url, { mode: 'no-cors', cache: 'no-store' });
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
  const online = options.online ?? isAppOnline();
  const downloaded = Boolean(categoryId) && downloadedSet.has(categoryId);
  const completeCoverage = Number(options.coveragePct) >= 100;

  if (localMedia || downloaded || completeCoverage) {
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

function addMediaCacheKeys(set, url) {
  if (!url) return;
  set.add(url);
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
  if (typeof caches === 'undefined') return cached;
  try {
    const cache = await caches.open(OFFLINE_CACHE);
    const keys = await cache.keys();
    for (const req of keys) addMediaCacheKeys(cached, req.url);
  } catch {
    return cached;
  }
  return cached;
}

export async function getCategoriesOfflineCoverage(categoryIds) {
  const ids = Array.isArray(categoryIds) ? categoryIds : [];
  const map = {};
  if (usesLocalMedia()) {
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

export function cancelDownload() {
  if (activeController) {
    activeController.abort();
    activeController = null;
  }
}

export async function downloadCategoryMedia(categoryId, onProgress) {
  if (OFFLINE_DOWNLOAD === 'packs' && PACKS_BASE) {
    return downloadCategoryMediaFromPacks(categoryId, onProgress);
  }
  return downloadCategoryMediaFromFiles(categoryId, onProgress);
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
    const downloaded = getDownloadedCategories();
    const manifest = loadManifest();
    downloaded.add(categoryId);
    manifest[categoryId] = [];
    saveDownloaded(downloaded);
    saveManifest(manifest);
    activeController = null;
    onProgress?.(1, 1);
    return { success: true, total: 0, failed: 0, cancelled: false };
  }

  const cache = typeof caches !== 'undefined'
    ? await caches.open(OFFLINE_CACHE)
    : null;

  let completed = 0;
  let failed = 0;
  let cancelled = false;

  for (let i = 0; i < mediaUrls.length; i += BATCH_SIZE) {
    if (controller.signal.aborted) {
      cancelled = true;
      break;
    }

    const batch = mediaUrls.slice(i, i + BATCH_SIZE);
    const results = await Promise.allSettled(batch.map(async (url) => {
      const request = getMediaRequest(url);
      const response = await fetch(request, { signal: controller.signal });
      if (cache) await cache.put(request, response.clone());
    }));

    for (const r of results) {
      if (r.status === 'fulfilled') {
        completed++;
      } else if (r.reason?.name === 'AbortError') {
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

  const downloaded = getDownloadedCategories();
  const manifest = loadManifest();
  if (!cancelled && failed === 0) downloaded.add(categoryId);
  else downloaded.delete(categoryId);
  if (!cancelled && failed === 0) manifest[categoryId] = mediaUrls;
  else delete manifest[categoryId];
  saveDownloaded(downloaded);
  saveManifest(manifest);
  notifyServiceWorkerOfflineMedia();

  return { success: !cancelled && failed === 0, total, failed, cancelled };
}

export async function reconcileDownloadedCategories() {
  const downloaded = getDownloadedCategories();
  const manifest = loadManifest();
  if (!downloaded.size) return downloaded;
  if (typeof caches === 'undefined') return downloaded;

  const cache = await caches.open(OFFLINE_CACHE);
  let changed = false;

  for (const categoryId of [...downloaded]) {
    const urls = manifest[categoryId];
    if (!Array.isArray(urls)) {
      downloaded.delete(categoryId);
      changed = true;
      continue;
    }
    let isComplete = true;
    for (const url of urls) {
      const cached = (await cache.match(url))
        || (await cache.match(new Request(url, { mode: 'cors' })))
        || (await cache.match(new Request(url, { mode: 'no-cors' })))
        || (await cache.match(getMediaRequest(url)));
      if (!cached) {
        isComplete = false;
        break;
      }
    }
    if (!isComplete) {
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
