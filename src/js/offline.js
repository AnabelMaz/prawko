// offline.js — Offline download management

import { fetchCategory, MEDIA_BASE } from './data.js';

const DOWNLOAD_KEY = 'prawko_offline';
const MANIFEST_KEY = 'prawko_offline_manifest';
const OFFLINE_CACHE = 'prawko-offline-media-v1';
const BATCH_SIZE = 6;

function toAbsoluteMediaUrl(url) {
  return new URL(url, document.baseURI).href;
}

function getMediaRequest(url, { noCors = false } = {}) {
  const abs = toAbsoluteMediaUrl(url);
  const sameOrigin = new URL(abs).origin === location.origin;
  if (noCors) return new Request(abs, { mode: 'no-cors', cache: 'reload' });
  if (sameOrigin) return new Request(abs, { mode: 'same-origin', cache: 'reload' });
  return new Request(abs, { mode: 'cors', cache: 'reload' });
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
    const prefix = q.mediaType === 'video' ? 'vid' : 'img';
    mediaUrls.push(toAbsoluteMediaUrl(`${MEDIA_BASE}/${prefix}/${encodeURIComponent(q.media)}`));
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
      let request = getMediaRequest(url);
      let response;
      try {
        response = await fetch(request, { signal: controller.signal });
      } catch (err) {
        if (err?.name === 'AbortError') throw err;
        request = getMediaRequest(url, { noCors: true });
        response = await fetch(request, { signal: controller.signal });
      }
      if (cache && (response.ok || response.type === 'opaque')) {
        await cache.put(new Request(toAbsoluteMediaUrl(url)), response.clone());
      } else if (!response.ok && response.type !== 'opaque') {
        throw new Error(`Media fetch failed: ${response.status}`);
      }
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
      const abs = toAbsoluteMediaUrl(url);
      const cached = (await cache.match(getMediaRequest(url)))
        || (await cache.match(abs))
        || (await cache.match(getMediaRequest(url, { noCors: true })));
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
