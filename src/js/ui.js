// ui.js — DOM rendering utilities

import { t, getLang, translateQuestion } from './i18n.js';
import { getCategoryStats, getLearnProgress, loadHistory, getLearnTouchedCategories, getLearnCategoryBreakdown, getLearnUniqueFilterCounts } from './stats.js';
import { getMediaUrls, fetchCategory, usesLocalMedia, isLoopbackHost, loadLocalConfig } from './data.js';
import { getCategoryMediaAccess, getCategoriesOfflineCoverage, getDownloadedCategories, getActiveDownloadProgress, getActiveDownloadCategory, getInProgressOfflineCategory, isAppOnline, offlineCoverageHue, resolvePlayableMediaUrl, storeMediaBlob } from './offline.js';
import { refitUiScale, layoutCategoryGrid, syncExamMediaAlign, alignAndFitExamDock, fitAfterShowScreen, shouldHoldScreenChange } from './scale.js';
import { abortMediaFeed, startMediaFeed } from './media-feed.js';
import { prepareAnswerFit, prepareDockFit } from './fit-text.js';

const MEDIA_ICON_PAUSE = '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path fill="currentColor" d="M6 5h4v14H6zm8 0h4v14h-4z"/></svg>';
const MEDIA_ICON_PLAY = '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path fill="currentColor" d="M8 5v14l11-7z"/></svg>';
const MEDIA_ICON_REPLAY = '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path fill="currentColor" d="M12 5V1L7 6l5 5V7c3.3 0 6 2.7 6 6s-2.7 6-6 6-6-2.7-6-6H4c0 4.4 3.6 8 8 8s8-3.6 8-8-3.6-8-8-8z"/></svg>';

export function showScreen(id) {
  const prev = document.querySelector('.screen.active')?.id;
  const swap = shouldHoldScreenChange(prev, id);
  if (swap) document.documentElement.setAttribute('data-ui-hold', '1');
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  const screen = document.getElementById(id);
  if (screen) screen.classList.add('active');
  fitAfterShowScreen(swap);
}

let _modalOnConfirm = null;
let _modalOnCancel = null;
let _categorySearchUiInitialized = false;
let _quizModeUiInitialized = false;

function getCategoryUiCopy() {
  if (getLang() === 'en') {
    return {
      clearSearch: 'Clear category search',
      searchHint: 'Filter by category letter or vehicle type',
      searchResults: '{visible} of {total} categories',
      emptyTitle: 'No matching category',
      emptyDescription: 'Try another phrase, for example: B, C1 or bus.',
    };
  }
  return {
    clearSearch: 'Wyczyść wyszukiwanie kategorii',
    searchHint: 'Filtruj po literze kategorii lub nazwie pojazdu',
    searchResults: '{visible} z {total} kategorii',
    emptyTitle: 'Brak pasującej kategorii',
    emptyDescription: 'Spróbuj innej frazy, np. B, C1 albo autobus.',
  };
}

function updateQuizModePill() {
  const modePill = document.getElementById('quiz-mode-pill');
  if (!modePill) return;
  const mode = document.querySelector('.mode-btn.active')?.dataset.mode === 'exam' ? 'exam' : 'learn';
  modePill.textContent = mode === 'exam' ? t('modeExam') : t('modeLearn');
  modePill.dataset.mode = mode;
}

function ensureQuizModeUi() {
  updateQuizModePill();
  if (_quizModeUiInitialized) return;
  document.getElementById('categories')?.addEventListener('click', (event) => {
    if (!event.target.closest('.mode-btn')) return;
    requestAnimationFrame(updateQuizModePill);
  });
  _quizModeUiInitialized = true;
}

function updateCategorySearchUi() {
  const input = document.getElementById('category-search');
  const clearBtn = document.getElementById('category-search-clear');
  const statusEl = document.getElementById('category-search-status');
  const emptyState = document.getElementById('category-empty-state');
  const emptyTitle = document.getElementById('category-empty-title');
  const emptyDescription = document.getElementById('category-empty-description');
  const grid = document.querySelector('.category-grid');
  if (!input || !clearBtn || !statusEl || !emptyState || !emptyTitle || !emptyDescription || !grid) return;

  const copy = getCategoryUiCopy();
  const query = input.value.trim();
  const allCards = [...grid.querySelectorAll('.category-card')].filter(card => !card.hidden);
  const visibleCards = allCards.filter(card => card.style.display !== 'none');
  const hasQuery = query.length > 0;

  clearBtn.setAttribute('aria-label', copy.clearSearch);
  clearBtn.hidden = !hasQuery;
  statusEl.textContent = hasQuery
    ? copy.searchResults.replace('{visible}', visibleCards.length).replace('{total}', allCards.length)
    : copy.searchHint;

  emptyTitle.textContent = copy.emptyTitle;
  emptyDescription.textContent = copy.emptyDescription;
  emptyState.hidden = !hasQuery || visibleCards.length > 0;
  layoutCategoryGrid();
}

function ensureCategorySearchUi() {
  const input = document.getElementById('category-search');
  const clearBtn = document.getElementById('category-search-clear');
  if (!input || !clearBtn) return;

  if (!_categorySearchUiInitialized) {
    input.addEventListener('input', () => requestAnimationFrame(updateCategorySearchUi));
    clearBtn.addEventListener('click', () => {
      input.value = '';
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.focus();
      requestAnimationFrame(updateCategorySearchUi);
    });
    _categorySearchUiInitialized = true;
  }

  updateCategorySearchUi();
}

export function showConfirmModal(title, description, onConfirm, options = {}) {
  const descEl = document.getElementById('modal-desc');
  document.getElementById('modal-title').textContent = title;
  if (options.html) {
    descEl.hidden = false;
    descEl.innerHTML = description;
  } else {
    descEl.textContent = description || '';
    descEl.hidden = !description;
  }

  const confirmBtn = document.querySelector('.btn-confirm-end');
  const cancelBtn = document.querySelector('.btn-cancel-end');
  const modal = document.getElementById('confirm-modal');
  if (confirmBtn) {
    confirmBtn.textContent = options.confirmLabel || t('confirmYes');
    confirmBtn.classList.remove('btn-danger', 'btn-secondary', 'btn-word-yellow', 'btn-word-orange');
    if (options.confirmVariant === 'word-yellow') confirmBtn.classList.add('btn-word-yellow');
    else if (options.confirmVariant === 'word-orange') confirmBtn.classList.add('btn-word-orange');
    else if (options.confirmVariant === 'secondary') confirmBtn.classList.add('btn-secondary');
    else confirmBtn.classList.add('btn-danger');
  }
  if (cancelBtn) {
    cancelBtn.textContent = options.cancelLabel || t('confirmNo');
    cancelBtn.hidden = Boolean(options.hideCancel);
    cancelBtn.classList.remove('btn-secondary', 'btn-word-yellow');
    if (options.cancelVariant === 'word-yellow') cancelBtn.classList.add('btn-word-yellow');
    else cancelBtn.classList.add('btn-secondary');
  }
  const dismissBtn = modal.querySelector('.modal-dismiss');
  if (dismissBtn) dismissBtn.hidden = !options.dismiss;
  modal.classList.toggle('exam-handoff', Boolean(options.handoff));
  modal.classList.toggle('exam-end', Boolean(options.wordEnd));
  restoreModalButtonOrder();
  if (options.wordEnd && confirmBtn && cancelBtn) {
    confirmBtn.parentElement?.insertBefore(cancelBtn, confirmBtn);
  }

  _modalOnConfirm = onConfirm;
  _modalOnCancel = options.onCancel || null;
  modal.classList.add('active');
  const focusBtn = options.wordEnd
    ? cancelBtn
    : modal.querySelector('button:not([hidden])');
  if (focusBtn) focusBtn.focus();
}

function restoreModalButtonOrder() {
  const confirmBtn = document.querySelector('.btn-confirm-end');
  const cancelBtn = document.querySelector('.btn-cancel-end');
  const actions = confirmBtn?.parentElement;
  if (!actions || !cancelBtn || !confirmBtn) return;
  actions.append(confirmBtn, cancelBtn);
}

export function confirmModalAction() {
  const cb = _modalOnConfirm;
  hideModal();
  if (cb) cb();
}

export function cancelModalAction() {
  const cb = _modalOnCancel;
  hideModal();
  if (cb) cb();
}

export function hideModal() {
  const modal = document.getElementById('confirm-modal');
  modal.classList.remove('active', 'exam-handoff', 'exam-end');
  const dismissBtn = modal.querySelector('.modal-dismiss');
  if (dismissBtn) dismissBtn.hidden = true;
  const descEl = document.getElementById('modal-desc');
  if (descEl) descEl.hidden = false;
  const confirmBtn = document.querySelector('.btn-confirm-end');
  const cancelBtn = document.querySelector('.btn-cancel-end');
  if (confirmBtn) {
    confirmBtn.classList.remove('btn-word-yellow', 'btn-word-orange', 'btn-secondary');
    confirmBtn.classList.add('btn-danger');
  }
  if (cancelBtn) {
    cancelBtn.hidden = false;
    cancelBtn.classList.remove('btn-word-yellow');
    cancelBtn.classList.add('btn-secondary');
  }
  restoreModalButtonOrder();
  _modalOnConfirm = null;
  _modalOnCancel = null;
}

function applyCategoryAccess(card, access) {
  if (!card) return;
  card.classList.toggle('category-unavailable', !access.available);
  card.setAttribute('aria-disabled', access.available ? 'false' : 'true');
  card.dataset.mediaAccess = !access.available ? 'blocked' : (access.offlineReady ? 'offline' : 'online');
  if (!access.available) card.title = t('unavailableOfflineHint');
  else card.removeAttribute('title');
}

/** While the question bank JSON is still warming, block entering a category. */
export function setCategoryCardsBankPending(pending) {
  document.querySelectorAll('.category-card').forEach((card) => {
    card.classList.toggle('bank-pending', pending);
    if (pending) {
      card.dataset.bankPending = '1';
      card.setAttribute('aria-busy', 'true');
    } else {
      delete card.dataset.bankPending;
      card.removeAttribute('aria-busy');
    }
  });
}

let lastCoverageMap = {};
let coverageScanId = 0;
let coverageScanTimer = 0;

function clampCoveragePct(pct) {
  const n = Math.round(Number(pct));
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(100, n));
}

export function formatOfflineRunningLabel(pct) {
  const n = Math.max(0, Math.min(99, Math.round(Number(pct) || 0)));
  return `\u2193 ${n}% \u00b7 ${t('stopOffline')}`;
}

function paintOfflineButton(dlBtn, access, coverage, known) {
  if (!dlBtn) return;
  const mine = dlBtn.dataset.category;
  // Przerwij only for a live job. IN_PROGRESS alone is a pending resume flag.
  const activeId = getActiveDownloadCategory();
  const pendingId = getInProgressOfflineCategory();
  const active = getActiveDownloadProgress(mine);
  if (activeId === mine) {
    dlBtn.classList.remove('coverage-pending');
    dlBtn.removeAttribute('aria-busy');
    const pct = active
      ? Math.max(0, Math.min(99, Math.round((active.done / Math.max(1, active.total)) * 100)))
      : clampCoveragePct(coverage?.pct);
    dlBtn.classList.add('downloading');
    dlBtn.classList.remove('downloaded', 'unavailable', 'partial', 'download-locked');
    dlBtn.style.setProperty('--dl-progress', String(pct));
    dlBtn.style.setProperty('--offline-hue', String(offlineCoverageHue(pct)));
    dlBtn.textContent = formatOfflineRunningLabel(pct);
    return;
  }
  if (!known && !access.offlineReady && access.canDownload) {
    dlBtn.classList.add('coverage-pending');
    dlBtn.classList.remove('downloading', 'downloaded', 'unavailable', 'partial', 'download-locked');
    dlBtn.style.removeProperty('--offline-hue');
    dlBtn.style.removeProperty('--dl-progress');
    delete dlBtn.dataset.offlinePct;
    dlBtn.textContent = '\u2026';
    dlBtn.setAttribute('aria-busy', 'true');
    return;
  }
  dlBtn.classList.remove('coverage-pending');
  dlBtn.removeAttribute('aria-busy');
  dlBtn.classList.remove('downloading');
  dlBtn.classList.toggle('download-locked', Boolean(activeId || pendingId));
  const pct = clampCoveragePct(coverage?.pct);
  // A few saved files in a large category round to 0%. That is still offline
  // progress: "Pobierz offline" would look like nothing was stored.
  const have = Number(coverage?.have) || 0;
  const showPct = !access.offlineReady && pct < 100 && (have > 0 || pct >= 1);

  dlBtn.classList.toggle('downloaded', access.offlineReady);
  dlBtn.classList.toggle('unavailable', !access.available);
  dlBtn.classList.toggle('partial', showPct);
  if (showPct) {
    dlBtn.style.setProperty('--offline-hue', String(offlineCoverageHue(pct)));
    dlBtn.dataset.offlinePct = String(pct);
    dlBtn.textContent = t('offlinePct').replace('{n}', String(pct));
    return;
  }
  dlBtn.style.removeProperty('--offline-hue');
  delete dlBtn.dataset.offlinePct;
  if (!access.available) dlBtn.textContent = t('unavailableOffline');
  else if (access.offlineReady) dlBtn.textContent = `\u2713 ${t('savedOffline')}`;
  else dlBtn.textContent = `\u2193 ${t('saveOffline')}`;
}

function paintCoverageMap(coverageMap, downloadedSet = new Set()) {
  lastCoverageMap = coverageMap && typeof coverageMap === 'object' ? coverageMap : {};
  const localMedia = usesLocalMedia();
  document.querySelectorAll('.category-grid .offline-btn[data-category]').forEach((dlBtn) => {
    const catId = dlBtn.dataset.category;
    const cov = lastCoverageMap[catId];
    const access = getCategoryMediaAccess(catId, downloadedSet, {
      localMedia,
      coveragePct: cov?.pct,
    });
    applyCategoryAccess(dlBtn.closest('.category-card'), access);
    paintOfflineButton(dlBtn, access, cov, Object.prototype.hasOwnProperty.call(lastCoverageMap, catId));
  });
}

export function applyOfflineCoverageToButtons(coverageMap, downloadedSet = new Set()) {
  if (coverageScanTimer) {
    clearTimeout(coverageScanTimer);
    coverageScanTimer = 0;
  }
  coverageScanId += 1;
  paintCoverageMap(coverageMap, downloadedSet);
}

export async function refreshOfflineCoverage(meta, downloadedSet = new Set()) {
  const ids = (meta?.categories || []).map((cat) => cat.id);
  if (!ids.length) return;
  const map = await getCategoriesOfflineCoverage(ids);
  applyOfflineCoverageToButtons(map, downloadedSet);
}

function scheduleCoverageScan(meta, downloadedSet) {
  const ids = (meta?.categories || []).map((cat) => cat.id);
  if (!ids.length) return;
  if (coverageScanTimer) clearTimeout(coverageScanTimer);
  coverageScanTimer = setTimeout(() => {
    coverageScanTimer = 0;
    const scanId = ++coverageScanId;
    getCategoriesOfflineCoverage(ids)
      .then((map) => {
        if (scanId !== coverageScanId) return;
        paintCoverageMap(map, downloadedSet);
      })
      .catch(() => {});
  }, 40);
}

export function renderCategories(meta, downloadedSet = new Set()) {
  const localMedia = usesLocalMedia();
  document.documentElement.dataset.localMedia = localMedia ? 'true' : 'false';

  meta.categories.forEach(cat => {
    const card = document.querySelector(`.category-grid .category-card[data-category="${CSS.escape(cat.id)}"]`);
    if (!card) return;
    const countEl = card.querySelector('.question-count');
    if (countEl) countEl.textContent = t('questionsCount').replace('{n}', cat.questionCount);

    // Progress info
    let progressEl = card.querySelector('.category-progress');
    if (!progressEl) {
      progressEl = document.createElement('div');
      progressEl.className = 'category-progress';
      card.appendChild(progressEl);
    }

    const learnDone = getLearnProgress(cat.id);
    const examStats = getCategoryStats(cat.id);
    const total = cat.questionCount;
    const percent = total > 0 ? Math.round((learnDone / total) * 100) : 0;

    progressEl.textContent = '';
    const selectedMode = document.querySelector('.mode-btn.active')?.dataset.mode === 'exam' ? 'exam' : 'learn';
    const bar = document.createElement('div');
    bar.className = 'progress-mini';
    const fill = document.createElement('div');
    fill.className = 'progress-mini-fill';
    const label = document.createElement('span');
    label.className = 'progress-text';

    if (selectedMode === 'learn') {
      fill.style.width = `${percent}%`;
      label.textContent = `${learnDone}/${total}`;
      bar.appendChild(fill);
      progressEl.append(bar, label);
    } else if (examStats) {
      const maxPoints = Number.isFinite(examStats.maxPoints) ? examStats.maxPoints : 74;
      const examPercent = maxPoints > 0 ? Math.round((examStats.lastScore / maxPoints) * 100) : 0;
      fill.style.width = `${examPercent}%`;
      label.textContent = `${examStats.lastScore}/${maxPoints}`;
      const passedLast = examStats.lastPassed === true;
      const badge = document.createElement('span');
      badge.className = `exam-badge ${passedLast ? 'pass' : 'fail'}`;
      badge.textContent = passedLast ? t('passed') : t('failed');
      bar.appendChild(fill);
      progressEl.append(bar, label, badge);
    } else {
      fill.style.width = '0%';
      label.textContent = t('noExamAttempts');
      bar.appendChild(fill);
      progressEl.append(bar, label);
    }

    // Offline download button
    let dlBtn = card.querySelector('.offline-btn');
    if (!dlBtn) {
      dlBtn = document.createElement('div');
      dlBtn.className = 'offline-btn';
      dlBtn.dataset.category = cat.id;
      card.appendChild(dlBtn);
    }
    const coverage = lastCoverageMap[cat.id];
    const access = getCategoryMediaAccess(cat.id, downloadedSet, {
      localMedia,
      coveragePct: coverage?.pct,
    });
    applyCategoryAccess(card, access);
    paintOfflineButton(dlBtn, access, coverage, Object.prototype.hasOwnProperty.call(lastCoverageMap, cat.id));
  });
  scheduleCoverageScan(meta, downloadedSet);
  requestAnimationFrame(() => {
    ensureCategorySearchUi();
    ensureQuizModeUi();
  });
}


// Times come from questions.json (mediaIn/mediaOut on the fact). Missing
// fields keep the old playback: start at 0, stop on the file's real last frame.
export function mediaClipStart(video) {
  const t = Number(video?.dataset?.mediaIn);
  return Number.isFinite(t) && t > 0.04 ? t : 0;
}

function mediaClipEnd(video) {
  const t = Number(video?.dataset?.mediaOut);
  if (!Number.isFinite(t) || t <= 0.04) return 0;
  const duration = video?.duration;
  if (Number.isFinite(duration) && duration > 0 && t >= duration - 0.04) return 0;
  return t;
}

function stampMediaClip(video, q) {
  const inn = Number(q && q.mediaIn);
  const out = Number(q && q.mediaOut);
  if (Number.isFinite(inn) && inn > 0.04) video.dataset.mediaIn = String(inn);
  if (Number.isFinite(out) && out > 0.04) video.dataset.mediaOut = String(out);
}

function bindClipStart(video) {
  const start = mediaClipStart(video);
  if (!start) return;
  const pin = () => {
    if (video.dataset.trimmedEnd === '1') return;
    if (video.currentTime < start - 0.03) {
      try { video.currentTime = start; } catch { /* not seekable yet */ }
    }
  };
  video.addEventListener('loadedmetadata', pin);
  video.addEventListener('loadeddata', pin);
}

function bindClipEnd(video) {
  if (!video.dataset.mediaOut) return;
  let reached = false;
  const reach = () => {
    if (reached) return;
    const end = mediaClipEnd(video);
    if (!end || video.currentTime + 0.03 < end) return;
    reached = true;
    video.dataset.trimmedEnd = '1';
    video.pause();
    const finish = () => video.dispatchEvent(new Event('ended'));
    if (video.currentTime > end + 0.03) {
      video.addEventListener('seeked', finish, { once: true });
      try { video.currentTime = end; } catch { finish(); }
    } else finish();
  };
  video.addEventListener('timeupdate', reach);
  video.addEventListener('play', () => {
    reached = false;
    delete video.dataset.trimmedEnd;
  });
}

// Keep the element invisible until currentTime is on the last picture, so frame 0 never paints.
function holdLearnVideoAtEnd(video, mediaArea, stillCurrent, onReady) {
  mediaArea.classList.add('learn-video-hold');
  let pinned = false;
  let seekArmed = false;

  const endTarget = () => {
    const duration = video.duration;
    const clip = mediaClipEnd(video);
    if (clip) return clip;
    if (!Number.isFinite(duration) || duration <= 0) return 0;
    return Math.max(0, duration - 0.001);
  };

  const atEnd = () => {
    const target = endTarget();
    if (target <= 0) return false;
    return video.currentTime >= target - 0.0005;
  };

  const show = () => {
    if (pinned || !stillCurrent() || !atEnd()) return;
    pinned = true;
    video.pause();
    mediaArea.classList.remove('learn-video-hold', 'loading', 'awaiting-frame');
    onReady();
  };

  const pin = () => {
    if (pinned || !stillCurrent()) return;
    const target = endTarget();
    if (target <= 0) return;
    if (atEnd()) {
      show();
      return;
    }
    if (seekArmed) return;
    seekArmed = true;
    try {
      video.currentTime = target;
    } catch {
      seekArmed = false;
    }
  };

  video.addEventListener('play', () => {
    if (!pinned) video.pause();
  });
  video.addEventListener('loadedmetadata', pin);
  video.addEventListener('loadeddata', pin);
  video.addEventListener('durationchange', pin);
  video.addEventListener('seeked', () => {
    if (pinned || !stillCurrent()) return;
    if (atEnd()) {
      show();
      return;
    }
    seekArmed = false;
    pin();
  });
  video.addEventListener('ended', show);
}

function bindMediaBufferSpinner(video, mediaArea, stillCurrent) {
  // Intent to play, not video.paused. A film that has one frame and is still
  // buffering reports paused, and that frame must not sit there like a photo.
  let wantPlay = video.autoplay === true;
  const skip = () => !stillCurrent()
    || video.ended
    || video.dataset.examEnded === '1'
    || video.dataset.trimmedEnd === '1'
    || mediaArea.classList.contains('learn-video-hold');
  const fromCache = () => {
    if (video.dataset.byteSource === 'live') return false;
    if (video.dataset.byteSource === 'stored') return true;
    return /^(blob|data):/i.test(video.currentSrc || video.src || '');
  };
  const show = () => {
    if (skip() || !wantPlay || fromCache()) return;
    mediaArea.classList.add('loading');
  };
  const hide = () => {
    if (!stillCurrent()) return;
    mediaArea.classList.remove('loading');
  };
  // A decoded frame is not playback. The ring stays until `playing`.
  const onFrame = () => {
    if (skip()) return;
    if (!wantPlay || fromCache()) hide();
  };
  const onWait = () => {
    if (skip() || !wantPlay || fromCache()) return;
    show();
  };
  video.addEventListener('play', () => {
    wantPlay = true;
    if (skip() || fromCache() || video.readyState >= 3) return;
    show();
  });
  video.addEventListener('playing', () => {
    wantPlay = true;
    hide();
  });
  video.addEventListener('waiting', onWait);
  video.addEventListener('stalled', onWait);
  video.addEventListener('loadeddata', onFrame);
  video.addEventListener('canplay', onFrame);
  video.addEventListener('ended', () => {
    wantPlay = false;
    hide();
  });
  return {
    notePause() {
      wantPlay = false;
      hide();
    },
    noteResume() {
      wantPlay = true;
      if (skip() || fromCache() || video.readyState >= 3) return;
      show();
    },
  };
}

function lockVideoChrome(video) {
  video.controls = false;
  video.playsInline = true;
  video.disablePictureInPicture = true;
  video.disableRemotePlayback = true;
  video.setAttribute('disablePictureInPicture', '');
  video.setAttribute('controlsList', 'nodownload nofullscreen noremoteplayback noplaybackrate nopictureinpicture');
  video.addEventListener('contextmenu', (e) => e.preventDefault());
}

let mediaLoadGen = 0;
let playableBlobUrl = '';

// blob/data → replay from offline-cache (second+ visit). First visit elsewhere:
// one page media-feed fetch → storeMediaBlob → paint from that body (MSE / object URL).
// Loopback + mediaBase media: files already on this computer — el.src, no copy.
function bindMediaElement(el, url) {
  if (!url) return;
  if (/^(blob|data):/i.test(url)) {
    el.dataset.byteSource = 'stored';
    el.src = url;
    // Stored replay keeps the caller's autoplay flag; kick play the same way
    // media-feed does after a live body (attribute alone is not enough after a src swap).
    if (el.tagName === 'VIDEO' && el.autoplay) {
      const pending = el.play();
      if (pending && typeof pending.catch === 'function') pending.catch(() => {});
    }
    return;
  }
  delete el.dataset.byteSource;
  let remote = false;
  try {
    remote = new URL(url, location.href).origin !== location.origin;
  } catch { /* a bad URL still goes to the element */ }
  if (!remote && usesLocalMedia() && isLoopbackHost()) {
    el.src = url;
    return;
  }
  startMediaFeed(el, url, storeMediaBlob);
}

function revokePlayableBlob() {
  if (!playableBlobUrl) return;
  URL.revokeObjectURL(playableBlobUrl);
  playableBlobUrl = '';
}

export function renderQuestion(question, container, options = {}) {
  const examMedia = options.examMedia === true;
  const learnMediaMark = options.learnMediaMark || null;
  const q = translateQuestion(question);
  const mediaArea = container.querySelector('.media-area');
  const answersDiv = document.querySelector('.answers');
  if (question?.id != null) container.dataset.questionId = String(question.id);
  else delete container.dataset.questionId;

  // Drop the previous view before its error handler can start another read.
  const mediaGen = ++mediaLoadGen;
  const oldVideo = mediaArea.querySelector('video');
  const oldCopy = oldVideo?.dataset?.pausedCopy || '';
  if (oldVideo) { oldVideo.pause(); oldVideo.removeAttribute('src'); oldVideo.load(); }
  if (oldCopy && oldCopy !== playableBlobUrl) URL.revokeObjectURL(oldCopy);
  abortMediaFeed();
  mediaArea.innerHTML = '';
  revokePlayableBlob();
  mediaArea.onclick = null;
  mediaArea.classList.remove('has-media', 'loading', 'awaiting-frame', 'has-learn-video', 'learn-video-hold', 'exam-film-pending', 'media-empty');
  mediaArea.removeAttribute('aria-hidden');
  mediaArea.removeAttribute('role');
  mediaArea.removeAttribute('aria-label');

  const dock = document.querySelector('#quiz .quiz-dock');
  const quiz = document.getElementById('quiz');
  const abc = q.type !== 'basic';
  if (answersDiv) {
    answersDiv.classList.toggle('abc-answers', abc);
    answersDiv.classList.toggle('yn-answers', !abc);
  }
  if (dock) dock.dataset.qtype = abc ? 'abc' : 'yn';
  if (dock) {
    void dock.offsetHeight;
    prepareAnswerFit(dock, q);
  }
  fillAnswerChoices(answersDiv, q);
  if (dock) prepareDockFit(dock, q);
  else {
    const fallback = container.querySelector('.question-text');
    if (fallback) fallback.textContent = q.q;
  }
  void quiz?.offsetHeight;
  void document.querySelector('#quiz .media-slot')?.offsetHeight;
  syncExamMediaAlign();

  if (q.media) {
    mediaArea.classList.add('has-media', 'loading', 'awaiting-frame');
    mediaArea.setAttribute('aria-hidden', 'false');
    // Filled after local.json answers. A slow 200 must not be read as "no
    // file" and sent to Backblaze; a fast 404 settles this immediately.
    let mediaCandidates = [];
    let mediaReady = null;
    const ensureMediaCandidates = () => {
      if (!mediaReady) {
        mediaReady = (async () => {
          await loadLocalConfig();
          if (mediaGen !== mediaLoadGen) return;
          mediaCandidates = getMediaUrls(q.media, q.mediaType);
        })();
      }
      return mediaReady;
    };

    let candidateIndex = 0;
    let triedStored = false;
    const getNextMediaUrl = () => {
      if (candidateIndex >= mediaCandidates.length) return null;
      const url = mediaCandidates[candidateIndex];
      candidateIndex += 1;
      return url;
    };
    const stillCurrent = () => mediaGen === mediaLoadGen;
    // A stored blob is the whole file from an earlier view. Otherwise the
    // element gets the file URL and one read of that response plays it.
    const takeStored = async () => {
      if (triedStored) return null;
      triedStored = true;
      const stored = await resolvePlayableMediaUrl(q.media, q.mediaType);
      if (!stillCurrent()) {
        if (stored) URL.revokeObjectURL(stored);
        return null;
      }
      if (stored) {
        playableBlobUrl = stored;
        return stored;
      }
      return null;
    };
    const nextPlayableUrl = async () => {
      await ensureMediaCandidates();
      if (!stillCurrent()) return null;
      if (isAppOnline()) {
        const url = getNextMediaUrl();
        if (url) {
          // Prefer a stored complete file so replay does not touch the network.
          const stored = await resolvePlayableMediaUrl(q.media, q.mediaType);
          if (!stillCurrent()) {
            if (stored) URL.revokeObjectURL(stored);
            return null;
          }
          if (stored) {
            playableBlobUrl = stored;
            triedStored = true;
            return stored;
          }
          return url;
        }
      }
      return takeStored();
    };

    const showMediaFallback = (onRetry) => {
      mediaArea.classList.remove('loading', 'awaiting-frame');
      mediaArea.innerHTML = '';
      if (examMedia) {
        mediaArea.classList.remove('has-media', 'exam-film-pending');
        mediaArea.classList.add('media-empty');
        mediaArea.setAttribute('aria-hidden', 'true');
        onLearnMediaSettled(learnMediaMark);
        return;
      }

      const fallback = document.createElement('div');
      fallback.className = 'media-fallback';

      const p = document.createElement('p');
      p.className = 'media-unavailable';
      p.append(t('mediaUnavailable'));

      const categoryId = options.categoryId;
      const access = categoryId
        ? getCategoryMediaAccess(categoryId, getDownloadedCategories())
        : { canDownload: false };
      if (categoryId && access.canDownload) {
        const link = document.createElement('a');
        link.className = 'media-offline-link';
        link.href = '#categories';
        link.textContent = t('mediaUnavailableDownload').replace('{cat}', categoryId);
        link.addEventListener('click', (e) => {
          e.preventDefault();
          document.dispatchEvent(new CustomEvent('prawko-offline-download', {
            detail: { categoryId },
          }));
        });
        p.append(link);
      }

      const retryBtn = document.createElement('button');
      retryBtn.type = 'button';
      retryBtn.className = 'btn btn-secondary media-retry-btn';
      retryBtn.textContent = t('retry');
      retryBtn.addEventListener('click', onRetry);

      fallback.append(p, retryBtn);
      mediaArea.appendChild(fallback);
      onLearnMediaSettled(learnMediaMark);
    };

    if (q.mediaType === 'video') {
      const loadVideo = () => {
        void (async () => {
          const mediaUrl = await nextPlayableUrl();
          if (!stillCurrent()) return;
          if (!mediaUrl) {
            showMediaFallback(() => {
              candidateIndex = 0;
              triedStored = false;
              loadVideo();
            });
            return;
          }

          mediaArea.classList.add('loading', 'awaiting-frame');
          mediaArea.innerHTML = '';

          const video = document.createElement('video');
          stampMediaClip(video, q);
          lockVideoChrome(video);
          video.preload = 'auto';
          video.addEventListener('error', () => {
            if (!stillCurrent()) return;
            if (video.error && video.error.code === 1) return;
            loadVideo();
          });
          if (examMedia) {
            video.autoplay = false;
            video.muted = false;
            video.tabIndex = -1;
            video.draggable = false;
            video.addEventListener('click', (e) => {
              e.preventDefault();
              e.stopPropagation();
            });
            video.addEventListener('ended', () => {
              video.pause();
              video.dataset.examEnded = '1';
            });
            const hideFilm = Boolean(options.hideFilm);
            if (hideFilm) {
              mediaArea.classList.add('exam-film-pending');
              const placeholder = document.createElement('div');
              placeholder.className = 'exam-film-placeholder';
              placeholder.setAttribute('aria-hidden', 'true');
              placeholder.innerHTML = '<svg viewBox="0 0 128 96" aria-hidden="true"><circle cx="42" cy="26" r="18"/><circle cx="78" cy="26" r="18"/><rect x="26" y="38" width="68" height="32"/><rect x="94" y="46" width="20" height="16"/><rect x="58" y="70" width="10" height="6"/><path d="M63 76L34 96h14l15-12 15 12h14z"/></svg>';
              mediaArea.appendChild(placeholder);
            }
            const pinStartFrame = () => {
              if (!mediaArea.classList.contains('exam-film-pending')) return;
              video.pause();
              try {
                const start = mediaClipStart(video);
                if (Math.abs(video.currentTime - start) > 0.02) video.currentTime = start;
              } catch {}
            };
            video.addEventListener('loadedmetadata', pinStartFrame);
            video.onloadeddata = () => {
              pinStartFrame();
              if (stillCurrent()) mediaArea.classList.remove('awaiting-frame');
            };
            mediaArea.appendChild(video);
            bindMediaBufferSpinner(video, mediaArea, stillCurrent);
            bindClipStart(video);
            bindClipEnd(video);
            bindMediaElement(video, mediaUrl);
            syncExamMediaAlign();
          } else {
            const holdEnd = options.holdVideoEnd === true;
            video.muted = true;
            video.autoplay = !holdEnd;
            video.onloadeddata = () => {
              if (!stillCurrent()) return;
              if (holdEnd) return;
              mediaArea.classList.remove('awaiting-frame');
              onLearnMediaSettled(learnMediaMark);
            };

            const transportIcons = {
              pause: MEDIA_ICON_PAUSE,
              resume: MEDIA_ICON_PLAY,
              replay: MEDIA_ICON_REPLAY,
            };
            const transportLabels = {
              pause: () => t('pauseMedia'),
              resume: () => t('resumeMedia'),
              replay: () => t('replayMedia'),
            };
            const transport = document.createElement('button');
            transport.type = 'button';
            transport.className = 'media-replay-btn';
            transport.hidden = true;
            let hideMarkForReplayPlay = false;
            const setTransport = (mode) => {
              if (mediaArea.classList.contains('learn-video-hold') && mode !== 'replay') return;
              transport.dataset.mode = mode;
              const label = transportLabels[mode]();
              transport.hidden = false;
              transport.setAttribute('aria-label', label);
              transport.title = label;
              transport.innerHTML = transportIcons[mode];
              mediaArea.classList.add('is-replayable');
            };
            const bufferSpinner = bindMediaBufferSpinner(video, mediaArea, stillCurrent);
            const replayFromStart = () => {
              bufferSpinner.noteResume();
              hideMarkForReplayPlay = true;
              mediaArea.classList.remove('learn-video-hold');
              delete video.dataset.trimmedEnd;
              try { video.currentTime = mediaClipStart(video); } catch { /* not seekable yet */ }
              video.muted = false;
              setLearnMediaMarkHidden(true);
              const pending = video.play();
              if (pending && typeof pending.catch === 'function') pending.catch(() => {});
            };
            const activateTransport = async () => {
              const mode = transport.dataset.mode;
              if (!mode) return;
              if (mode === 'replay' || video.ended) {
                replayFromStart();
                return;
              }
              // Pause and resume leave the session mark as it is.
              // Only watching through to the end brings it back.
              if (mode === 'resume') {
                bufferSpinner.noteResume();
                const pending = video.play();
                if (pending && typeof pending.catch === 'function') pending.catch(() => {});
                return;
              }
              bufferSpinner.notePause();
              video.pause();
              if (video.paused) setTransport('resume');
            };
            transport.addEventListener('click', (e) => {
              e.preventDefault();
              e.stopPropagation();
              activateTransport();
            });
            // The film fills the frame and ignores hits, so the area receives them.
            // The corner button is the same action and keeps the visible state.
            mediaArea.onclick = (e) => {
              if (e.target.closest('.media-replay-btn')) return;
              e.preventDefault();
              activateTransport();
            };
            video.addEventListener('play', () => {
              if (mediaArea.classList.contains('learn-video-hold')) return;
              if (hideMarkForReplayPlay) setLearnMediaMarkHidden(true);
              setTransport('pause');
            });
            video.addEventListener('pause', () => {
              if (mediaArea.classList.contains('learn-video-hold')) return;
              if (video.ended || video.dataset.trimmedEnd === '1') return;
              setTransport('resume');
            });
            video.addEventListener('ended', () => {
              hideMarkForReplayPlay = false;
              setTransport('replay');
              onLearnMediaSettled(learnMediaMark);
            });

            mediaArea.classList.add('has-learn-video');
            if (holdEnd) {
              holdLearnVideoAtEnd(video, mediaArea, stillCurrent, () => {
                setTransport('replay');
                onLearnMediaSettled(learnMediaMark);
              });
            }
            mediaArea.append(video, transport);
            if (!holdEnd) {
              bindClipStart(video);
              bindClipEnd(video);
            }
            bindMediaElement(video, mediaUrl);
            if (!holdEnd && video.readyState >= 2) onLearnMediaSettled(learnMediaMark);
            syncExamMediaAlign();
          }
        })();
      };
      loadVideo();
    } else if (q.mediaType === 'image') {
      const loadImage = () => {
        void (async () => {
          let mediaUrl = await nextPlayableUrl();
          if (!stillCurrent()) return;
          if (!mediaUrl) {
            showMediaFallback(() => {
              candidateIndex = 0;
              triedStored = false;
              loadImage();
            });
            return;
          }

          mediaArea.classList.add('loading', 'awaiting-frame');
          mediaArea.innerHTML = '';

          const img = document.createElement('img');
          const onImageReady = () => {
            if (!stillCurrent()) return;
            mediaArea.classList.remove('loading', 'awaiting-frame');
            onLearnMediaSettled(learnMediaMark);
          };
          img.onload = onImageReady;
          img.onerror = () => {
            if (!stillCurrent()) return;
            // No src yet is normal while the page read is in flight. A failed
            // owned fetch keeps byteSource=live and must try the next URL.
            if (!img.getAttribute('src') && img.dataset.byteSource !== 'live') return;
            loadImage();
          };
          img.alt = t('imgAlt');
          img.loading = 'eager';
          img.decoding = 'async';
          img.width = 1280;
          img.height = 720;
          if (examMedia) {
            img.draggable = false;
            img.tabIndex = -1;
            img.addEventListener('mousedown', (e) => e.preventDefault());
            img.addEventListener('click', (e) => e.preventDefault());
            img.addEventListener('contextmenu', (e) => e.preventDefault());
          } else {
            // Answered questions keep the result mark on the photo. A click
            // peeks under it; another click puts it back. Unanswered: no mark.
            mediaArea.onclick = (e) => {
              if (e.target.closest('.media-retry-btn, .media-offline-link, .media-fallback')) return;
              const mark = mediaArea.querySelector('.learn-media-mark');
              if (!mark) return;
              e.preventDefault();
              setLearnMediaMarkHidden(!mark.hidden);
            };
          }
          mediaArea.appendChild(img);
          bindMediaElement(img, mediaUrl);
          if (img.getAttribute('src') && img.complete) onImageReady();
          syncExamMediaAlign();
        })();
      };
      loadImage();
    }
  } else {
    mediaArea.classList.add('media-empty');
    if (options.examMedia) {
      mediaArea.setAttribute('aria-hidden', 'true');
    } else {
      mediaArea.setAttribute('aria-hidden', 'false');
      mediaArea.setAttribute('role', 'img');
      mediaArea.setAttribute('aria-label', t('noMedia'));
      mediaArea.innerHTML = '<svg class="media-empty-icon" viewBox="0 0 96 72" aria-hidden="true"><rect x="16" y="24" width="52" height="36" rx="6" fill="none" stroke="currentColor" stroke-width="3"/><rect x="24" y="14" width="18" height="12" rx="3" fill="none" stroke="currentColor" stroke-width="3"/><circle cx="42" cy="42" r="10" fill="none" stroke="currentColor" stroke-width="4" stroke-linecap="round"/></svg>';
    }
    onLearnMediaSettled(learnMediaMark);
  }

  alignAndFitExamDock();
}

function fillAnswerChoices(answersDiv, q) {
  if (!answersDiv) return;
  answersDiv.innerHTML = '';
  if (q.type === 'basic') {
    answersDiv.classList.add('yn-answers');
    answersDiv.classList.remove('abc-answers');
    ['T', 'N'].forEach(val => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'answer-btn';
      btn.dataset.answer = val;
      btn.textContent = val === 'T' ? t('yes') : t('no');
      answersDiv.appendChild(btn);
    });
    return;
  }
  answersDiv.classList.remove('yn-answers');
  answersDiv.classList.add('abc-answers');
  const dock = answersDiv.closest('.quiz-dock');
  const aSize = dock?.style.getPropertyValue('--dock-a-size') || '';
  ['A', 'B', 'C'].forEach(val => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'answer-btn';
    btn.dataset.answer = val;
    const label = document.createElement('span');
    label.className = 'answer-label';
    label.textContent = val;
    btn.appendChild(label);
    const text = document.createElement('span');
    text.className = 'answer-text';
    text.textContent = q[val.toLowerCase()] || '';
    if (aSize) text.style.fontSize = aSize;
    btn.appendChild(text);
    answersDiv.appendChild(btn);
  });
}

export function markSelectedAnswer(answersDiv, selected) {
  answersDiv.querySelectorAll('.answer-btn').forEach((btn) => {
    const isSelected = btn.dataset.answer === selected;
    btn.classList.toggle('selected', isSelected);
    btn.setAttribute('aria-pressed', isSelected ? 'true' : 'false');
  });
}

export function setAnswerButtonsEnabled(enabled) {
  document.querySelector('.answers')?.querySelectorAll('.answer-btn').forEach((btn) => {
    btn.disabled = !enabled;
    btn.setAttribute('aria-disabled', enabled ? 'false' : 'true');
  });
}

function waitForVideoPlayable(video, timeoutMs = 15000) {
  if (video.readyState >= 2) return Promise.resolve();
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      video.removeEventListener('canplay', onReady);
      video.removeEventListener('error', onErr);
      if (err) reject(err);
      else resolve();
    };
    const timer = setTimeout(() => finish(new Error('timeout')), timeoutMs);
    const onReady = () => finish();
    const onErr = () => finish(new Error('error'));
    video.addEventListener('canplay', onReady);
    video.addEventListener('error', onErr);
    if (video.readyState >= 2) finish();
  });
}

export function playExamVideo(container) {
  const mediaArea = container.querySelector('.media-area');
  mediaArea?.classList.remove('exam-film-pending');
  mediaArea?.querySelector('.exam-film-placeholder')?.remove();
  mediaArea?.querySelector('.exam-media-start')?.remove();
  const video = mediaArea?.querySelector('video');
  if (!video) return Promise.resolve(false);
  const pending = video.dataset.pendingSrc;
  if (pending) {
    video.preload = 'auto';
    video.src = pending;
    delete video.dataset.pendingSrc;
  }
  if (!video.currentSrc && !video.src) return Promise.resolve(false);

  delete video.dataset.examEnded;
  const attempt = () => {
    try {
      const start = mediaClipStart(video);
      if (video.ended || video.dataset.trimmedEnd === '1' || video.currentTime > start + 0.05) {
        video.currentTime = start;
      }
    } catch {}
    delete video.dataset.trimmedEnd;
    return video.play();
  };

  return waitForVideoPlayable(video)
    .then(attempt)
    .catch(() => {
      video.muted = true;
      return attempt();
    })
    .then(() => !video.paused)
    .catch(() => false);
}

export function showLearnMediaMark(isCorrect) {
  const mediaArea = document.querySelector('#quiz .media-area');
  if (!mediaArea) return;
  let mark = mediaArea.querySelector('.learn-media-mark');
  if (!mark) {
    mark = document.createElement('div');
    mark.className = 'learn-media-mark';
    mark.setAttribute('aria-hidden', 'true');
    mediaArea.appendChild(mark);
  }
  mark.classList.toggle('correct', isCorrect);
  mark.classList.toggle('incorrect', !isCorrect);
  mark.textContent = isCorrect ? '\u2713' : '\u2717';
  mark.hidden = false;
}

function onLearnMediaSettled(learnMediaMark) {
  if (learnMediaMark) {
    showLearnMediaMark(learnMediaMark.isCorrect);
    return;
  }
  setLearnMediaMarkHidden(false);
}

function setLearnMediaMarkHidden(hidden) {
  const mark = document.querySelector('#quiz .media-area .learn-media-mark');
  if (mark) mark.hidden = Boolean(hidden);
}

export function highlightAnswer(answersDiv, selected, correct) {
  // Ensure screen readers announce answer result changes
  if (!answersDiv.hasAttribute('aria-live')) {
    answersDiv.setAttribute('aria-live', 'polite');
  }

  const correctLabel = getLang() === 'en' ? 'Correct' : 'Poprawna';
  const incorrectLabel = getLang() === 'en' ? 'Incorrect' : 'Niepoprawna';

  const buttons = answersDiv.querySelectorAll('.answer-btn');
  buttons.forEach(btn => {
    btn.disabled = true;
    const answer = btn.dataset.answer;
    if (answer === correct) {
      btn.classList.add('correct');
      btn.setAttribute('aria-label', `${btn.textContent.trim()} – ${correctLabel}`);
    }
    if (answer === selected && selected !== correct) {
      btn.classList.add('incorrect');
      btn.setAttribute('aria-label', `${btn.textContent.trim()} – ${incorrectLabel}`);
    }
  });
}

function bindMediaFallback(el, urls) {
  let i = 0;
  const tryUrl = () => {
    if (i >= urls.length) return;
    abortMediaFeed();
    bindMediaElement(el, urls[i++]);
  };
  el.addEventListener('error', tryUrl);
  tryUrl();
}

function appendReviewMedia(container, q) {
  if (!q.media) return;
  void loadLocalConfig().then(() => {
    if (!container.isConnected) return;
    appendReviewMediaNow(container, q);
  });
}

function appendReviewMediaNow(container, q) {
  const wrap = document.createElement('div');
  wrap.className = 'review-media';
  const urls = getMediaUrls(q.media, q.mediaType);
  if (!urls.length) return;
  if (q.mediaType === 'video') {
    wrap.classList.add('has-review-video');
    const video = document.createElement('video');
    stampMediaClip(video, q);
    lockVideoChrome(video);
    video.preload = 'metadata';
    wrap.addEventListener('click', (e) => {
      if (e.target.closest('.media-replay-btn')) return;
      if (video.ended || video.dataset.trimmedEnd === '1') video.currentTime = mediaClipStart(video);
      if (video.paused || video.ended || video.dataset.trimmedEnd === '1') video.play();
      else video.pause();
    });

    const replay = document.createElement('button');
    replay.type = 'button';
    replay.className = 'media-replay-btn';
    const setPlaybackControl = (mode) => {
      wrap.classList.toggle('is-replayable', Boolean(mode));
      replay.hidden = !mode;
      if (mode === 'replay') {
        replay.innerHTML = MEDIA_ICON_REPLAY;
        replay.setAttribute('aria-label', t('replayMedia'));
        replay.title = t('replayMedia');
      } else if (mode === 'play') {
        replay.innerHTML = MEDIA_ICON_PLAY;
        replay.setAttribute('aria-label', t('playMedia'));
        replay.title = t('playMedia');
      }
    };
    replay.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (video.ended || video.dataset.trimmedEnd === '1') video.currentTime = mediaClipStart(video);
      setPlaybackControl(null);
      video.play();
    });
    video.addEventListener('play', () => setPlaybackControl(null));
    video.addEventListener('pause', () => {
      if (!video.ended && video.dataset.trimmedEnd !== '1') setPlaybackControl('play');
    });
    video.addEventListener('ended', () => setPlaybackControl('replay'));
    bindClipStart(video);
    bindClipEnd(video);
    bindMediaFallback(video, urls);
    wrap.append(video, replay);
    setPlaybackControl('play');
  } else {
    const img = document.createElement('img');
    img.alt = t('imgAlt');
    bindMediaFallback(img, urls);
    wrap.appendChild(img);
  }
  container.appendChild(wrap);
}

function reviewOutcome(item) {
  if (item.isCorrect) return 'ok';
  if (item.given) return 'bad';
  return 'skip';
}

export function renderResults(result) {
  const scoreValue = document.querySelector('.score-value');
  const scoreMax = document.querySelector('.score-max');
  const verdict = document.querySelector('.result-verdict');
  const basicScore = document.querySelector('.basic-score');
  const specialistScore = document.querySelector('.specialist-score');
  const totalScore = document.querySelector('.total-score');
  const basicMax = document.querySelector('.basic-max');
  const specialistMax = document.querySelector('.specialist-max');
  const totalMax = document.querySelector('.total-max');
  const reviewList = document.querySelector('.incorrect-list');
  const scoreCircle = document.querySelector('.score-circle');

  scoreValue.textContent = result.score;
  if (scoreMax) scoreMax.textContent = `/ ${result.maxPoints}`;
  basicScore.textContent = result.basicScore;
  specialistScore.textContent = result.specialistScore;
  totalScore.textContent = '';
  const strong = document.createElement('strong');
  strong.textContent = result.score;
  totalScore.appendChild(strong);

  const answers = result.answers || [];
  const sumPoints = (type) => answers
    .filter((a) => a.question?.type === type)
    .reduce((sum, a) => sum + (Number(a.points) || 0), 0);
  if (basicMax) basicMax.textContent = String(sumPoints('basic'));
  if (specialistMax) specialistMax.textContent = String(sumPoints('specialist'));
  if (totalMax) totalMax.textContent = String(result.maxPoints);

  // Score circle visual
  const percent = Math.round((result.score / result.maxPoints) * 100);
  scoreCircle.style.setProperty('--score-percent', percent);
  scoreCircle.classList.remove('pass', 'fail');
  scoreCircle.classList.add(result.passed ? 'pass' : 'fail');

  // Verdict
  verdict.textContent = result.passed ? t('passed') : t('failed');
  verdict.classList.remove('pass', 'fail');
  verdict.classList.add(result.passed ? 'pass' : 'fail');

  const correctCount = answers.filter((a) => a.isCorrect).length;
  const skippedCount = answers.filter((a) => !a.given).length;
  const incorrectCount = answers.length - correctCount - skippedCount;

  reviewList.innerHTML = '';
  const heading = document.createElement('h3');
  heading.textContent = `${t('questionReview')} (${answers.length})`;
  const stats = document.createElement('p');
  stats.className = 'review-stats';
  stats.textContent = `${t('reviewCorrectCount')}: ${correctCount} · ${t('reviewIncorrectCount')}: ${incorrectCount} · ${t('reviewSkippedCount')}: ${skippedCount}`;
  reviewList.append(heading, stats);

  answers.forEach((item, index) => {
    const q = translateQuestion(item.question);
    const outcome = reviewOutcome(item);
    const details = document.createElement('details');
    details.className = `review-item review-item-${outcome}`;

    const summary = document.createElement('summary');
    const markLabel = outcome === 'ok'
      ? t('reviewCorrectCount')
      : outcome === 'bad'
        ? t('reviewIncorrectCount')
        : t('reviewSkippedCount');
    summary.setAttribute('aria-label', `${index + 1}. ${markLabel}`);
    const indexEl = document.createElement('span');
    indexEl.className = 'review-index';
    indexEl.textContent = String(index + 1);
    const mark = document.createElement('span');
    mark.className = 'review-mark';
    mark.textContent = outcome === 'ok' ? '\u2713' : outcome === 'bad' ? '\u2717' : '\u2212';
    mark.setAttribute('aria-hidden', 'true');
    summary.append(indexEl, mark);

    const body = document.createElement('div');
    body.className = 'review-body';
    details.append(summary, body);
    details.addEventListener('toggle', () => {
      if (!details.open) {
        body.querySelector('video')?.pause();
        refitUiScale();
        return;
      }
      document.querySelectorAll('.review-item video').forEach((video) => {
        if (!body.contains(video)) video.pause();
      });
      if (body.dataset.ready) {
        refitUiScale();
        return;
      }
      body.dataset.ready = '1';
      if (q.media) appendReviewMedia(body, q);
      const qText = document.createElement('p');
      qText.className = 'incorrect-question';
      qText.textContent = q.q;
      if (outcome === 'skip') {
        const skipped = document.createElement('p');
        skipped.className = 'review-no-answer';
        skipped.textContent = t('noAnswer');
        body.append(qText, skipped);
      } else {
        body.append(qText);
      }
      const answersDiv = document.createElement('div');
      answersDiv.className = 'review-answers';
      fillAnswerChoices(answersDiv, q);
      highlightAnswer(answersDiv, item.given, q.correct);
      body.append(answersDiv);
      refitUiScale();
    });
    reviewList.appendChild(details);
  });
  refitUiScale();
}

export function renderHistory() {
  const history = loadHistory();
  const listEl = document.querySelector('.history-list');
  const emptyEl = document.querySelector('.history-empty');
  const introEl = document.querySelector('.history-intro');
  const clearBtn = document.querySelector('.btn-clear-history');

  listEl.innerHTML = '';

  if (history.length === 0) {
    emptyEl.style.display = '';
    if (introEl) introEl.style.display = 'none';
    if (clearBtn) clearBtn.style.display = 'none';
    return;
  }

  emptyEl.style.display = 'none';
  if (introEl) introEl.style.display = '';
  if (clearBtn) clearBtn.style.display = '';

  // Show newest first
  [...history].reverse().forEach(r => {
    const item = document.createElement('div');
    item.className = 'history-item';

    const info = document.createElement('div');
    info.className = 'history-item-info';
    const cat = document.createElement('div');
    cat.className = 'history-item-category';
    cat.textContent = r.category;
    const date = document.createElement('div');
    date.className = 'history-item-date';
    date.textContent = new Date(r.date).toLocaleDateString(getLang() === 'en' ? 'en-GB' : 'pl-PL', {
      day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit'
    });
    info.append(cat, date);
    if (Number.isFinite(r.basicScore) && Number.isFinite(r.specialistScore)) {
      const parts = document.createElement('div');
      parts.className = 'history-item-parts';
      parts.textContent = t('historyParts')
        .replace('{basic}', String(r.basicScore))
        .replace('{specialist}', String(r.specialistScore));
      info.appendChild(parts);
    }

    const scoreDiv = document.createElement('div');
    scoreDiv.className = `history-item-score ${r.passed ? 'pass' : 'fail'}`;
    scoreDiv.textContent = `${r.score}/${r.maxPoints}`;
    const badge = document.createElement('div');
    badge.className = `history-item-badge ${r.passed ? 'pass' : 'fail'}`;
    badge.textContent = r.passed ? t('passed') : t('failed');
    scoreDiv.appendChild(badge);

    item.append(info, scoreDiv);
    listEl.appendChild(item);
  });
}

let _learnProgressRender = 0;

function learnProgressChip(value, label) {
  const chip = document.createElement('div');
  chip.className = 'learn-progress-chip';
  const num = document.createElement('span');
  num.className = 'learn-progress-chip-value';
  num.textContent = String(value);
  const name = document.createElement('span');
  name.className = 'learn-progress-chip-label';
  name.textContent = label;
  chip.append(num, name);
  return chip;
}

export async function renderLearnProgress(meta) {
  const listEl = document.querySelector('.learn-progress-list');
  const emptyEl = document.querySelector('.learn-progress-empty');
  const introEl = document.querySelector('.learn-progress-intro');
  const summaryEl = document.querySelector('.learn-progress-summary');
  const clearBtn = document.querySelector('.btn-clear-learn');
  if (!listEl || !emptyEl) return;

  const token = ++_learnProgressRender;
  const touched = new Set(getLearnTouchedCategories());
  const cats = (meta?.categories || []).filter((cat) => touched.has(cat.id));

  listEl.innerHTML = '';
  if (summaryEl) {
    summaryEl.innerHTML = '';
    summaryEl.hidden = true;
  }

  if (!cats.length) {
    emptyEl.style.display = '';
    if (introEl) introEl.style.display = 'none';
    if (clearBtn) clearBtn.style.display = 'none';
    return;
  }

  emptyEl.style.display = 'none';
  if (introEl) introEl.style.display = '';
  if (clearBtn) clearBtn.style.display = '';

  const loaded = await Promise.all(cats.map(async (cat) => {
    try {
      const data = await fetchCategory(cat.id);
      return { id: cat.id, questions: data.questions };
    } catch {
      return null;
    }
  }));
  if (token !== _learnProgressRender) return;

  const rows = [];
  const banks = [];
  for (const item of loaded) {
    if (!item) continue;
    banks.push({ category: item.id, questions: item.questions });
    rows.push({ id: item.id, ...getLearnCategoryBreakdown(item.id, item.questions) });
  }

  if (!rows.length) {
    emptyEl.style.display = '';
    if (introEl) introEl.style.display = 'none';
    if (clearBtn) clearBtn.style.display = 'none';
    return;
  }

  const totals = getLearnUniqueFilterCounts(banks);

  if (summaryEl) {
    summaryEl.hidden = false;
    summaryEl.append(
      learnProgressChip(totals.unknown, t('learnFilterUnknown')),
      learnProgressChip(totals.hard, t('learnFilterHard')),
      learnProgressChip(totals.known, t('learnFilterKnown')),
      learnProgressChip(totals.total, t('learnFilterAll')),
    );
  }

  rows.forEach((row) => {
    const item = document.createElement('div');
    item.className = 'learn-progress-item';
    const head = document.createElement('div');
    head.className = 'learn-progress-item-head';
    const catEl = document.createElement('div');
    catEl.className = 'learn-progress-item-category';
    catEl.textContent = row.id;
    const knownEl = document.createElement('div');
    knownEl.className = 'learn-progress-item-known';
    knownEl.textContent = `${row.known} ${t('learnProgressOf').replace('{total}', String(row.total))}`;
    head.append(catEl, knownEl);
    const line = document.createElement('p');
    line.className = 'learn-progress-item-line';
    line.textContent = `${row.known} ${t('learnProgressKnown')} · ${row.wrong} ${t('learnProgressWrong')} · ${row.hard} ${t('learnProgressHard')} · ${row.learning} ${t('learnProgressLearning')} · ${row.neu} ${t('learnProgressNew')} · ${row.answered} ${t('learnProgressAnswered')}`;
    item.append(head, line);
    listEl.appendChild(item);
  });
}

/** Apply current language to all data-i18n elements */
export function applyLanguage() {
  document.querySelectorAll('[data-i18n]').forEach(el => {
    if (el.dataset.i18n === 'tagline') return;
    el.textContent = t(el.dataset.i18n);
  });
  document.querySelectorAll('[data-i18n-aria]').forEach(el => {
    el.setAttribute('aria-label', t(el.getAttribute('data-i18n-aria')));
  });
  document.querySelectorAll('[data-i18n-title]').forEach((el) => {
    el.setAttribute('title', t(el.getAttribute('data-i18n-title')));
  });
  ensureCategorySearchUi();
  ensureQuizModeUi();
  document.dispatchEvent(new CustomEvent('prawko:language'));
}