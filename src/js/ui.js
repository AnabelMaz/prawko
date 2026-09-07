// ui.js — DOM rendering utilities

import { t, getLang, translateQuestion } from './i18n.js';
import { getCategoryStats, getLearnProgress, loadHistory, getLearnTouchedCategories, getLearnCategoryBreakdown } from './stats.js';
import { getMediaUrls, fetchCategory, usesLocalMedia } from './data.js';
import { getCategoryMediaAccess } from './offline.js';
import { refitUiScale, layoutCategoryGrid } from './scale.js';
import { scheduleFitQuizDockText } from './fit-text.js';

export function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  const screen = document.getElementById(id);
  if (screen) screen.classList.add('active');
}

let _modalOnConfirm = null;
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
  modal.classList.toggle('exam-handoff', Boolean(options.handoff));
  modal.classList.toggle('exam-end', Boolean(options.wordEnd));
  restoreModalButtonOrder();
  if (options.wordEnd && confirmBtn && cancelBtn) {
    confirmBtn.parentElement?.insertBefore(cancelBtn, confirmBtn);
  }

  _modalOnConfirm = onConfirm;
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

export function hideModal() {
  const modal = document.getElementById('confirm-modal');
  modal.classList.remove('active', 'exam-handoff', 'exam-end');
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
}

function applyCategoryAccess(card, access) {
  if (!card) return;
  card.classList.toggle('category-unavailable', !access.available);
  card.setAttribute('aria-disabled', access.available ? 'false' : 'true');
  card.dataset.mediaAccess = !access.available ? 'blocked' : (access.offlineReady ? 'offline' : 'online');
  if (!access.available) card.title = t('unavailableOfflineHint');
  else card.removeAttribute('title');
}

export function renderCategories(meta, downloadedSet = new Set()) {
  const localMedia = usesLocalMedia();
  document.documentElement.dataset.localMedia = localMedia ? 'true' : 'false';
  document.documentElement.dataset.appOnline = navigator.onLine !== false ? 'true' : 'false';

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
    const access = getCategoryMediaAccess(cat.id, downloadedSet, { localMedia });
    applyCategoryAccess(card, access);

    if (!dlBtn.classList.contains('downloading')) {
      dlBtn.classList.toggle('downloaded', access.offlineReady);
      dlBtn.classList.toggle('unavailable', !access.available);
      if (!access.available) dlBtn.textContent = t('unavailableOffline');
      else if (access.offlineReady) dlBtn.textContent = `\u2713 ${t('savedOffline')}`;
      else dlBtn.textContent = `\u2193 ${t('saveOffline')}`;
    }
  });
  requestAnimationFrame(() => {
    ensureCategorySearchUi();
    ensureQuizModeUi();
  });
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

export function renderQuestion(question, container, options = {}) {
  const examMedia = options.examMedia === true;
  const q = translateQuestion(question);
  const mediaArea = container.querySelector('.media-area');
  const questionText = container.querySelector('.question-text')
    || document.querySelector('#quiz .question-text');
  const answersDiv = document.querySelector('.answers');
  if (question?.id != null) container.dataset.questionId = String(question.id);
  else delete container.dataset.questionId;

  // Stop any playing video before clearing
  const oldVideo = mediaArea.querySelector('video');
  if (oldVideo) { oldVideo.pause(); oldVideo.removeAttribute('src'); oldVideo.load(); }
  mediaArea.innerHTML = '';
  mediaArea.onclick = null;
  mediaArea.classList.remove('has-media', 'loading', 'has-learn-video', 'exam-film-pending', 'media-empty');
  mediaArea.removeAttribute('aria-hidden');
  mediaArea.removeAttribute('role');
  mediaArea.removeAttribute('aria-label');

  if (q.media) {
    mediaArea.classList.add('has-media', 'loading');
    mediaArea.setAttribute('aria-hidden', 'false');
    const mediaCandidates = getMediaUrls(q.media, q.mediaType);

    let candidateIndex = 0;
    const getNextMediaUrl = () => {
      if (candidateIndex >= mediaCandidates.length) return null;
      const url = mediaCandidates[candidateIndex];
      candidateIndex += 1;
      return url;
    };

    const showMediaFallback = (onRetry) => {
      mediaArea.classList.remove('loading');
      mediaArea.innerHTML = '';
      if (examMedia) {
        mediaArea.classList.remove('has-media', 'exam-film-pending');
        mediaArea.classList.add('media-empty');
        mediaArea.setAttribute('aria-hidden', 'true');
        return;
      }

      const fallback = document.createElement('div');
      fallback.className = 'media-fallback';

      const p = document.createElement('p');
      p.className = 'media-unavailable';
      p.textContent = t('mediaUnavailable');

      const retryBtn = document.createElement('button');
      retryBtn.type = 'button';
      retryBtn.className = 'btn btn-secondary media-retry-btn';
      retryBtn.textContent = t('retry');
      retryBtn.addEventListener('click', onRetry);

      fallback.append(p, retryBtn);
      mediaArea.appendChild(fallback);
    };

    if (q.mediaType === 'video') {
      const loadVideo = () => {
        const mediaUrl = getNextMediaUrl();
        if (!mediaUrl) {
          showMediaFallback(() => {
            candidateIndex = 0;
            loadVideo();
          });
          return;
        }

        mediaArea.classList.add('loading');
        mediaArea.innerHTML = '';

        const video = document.createElement('video');
        lockVideoChrome(video);
        video.preload = examMedia ? 'auto' : 'metadata';
        video.onerror = () => loadVideo();
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
              if (video.currentTime !== 0) video.currentTime = 0;
            } catch {}
          };
          video.addEventListener('loadedmetadata', pinStartFrame);
          video.onloadeddata = () => {
            mediaArea.classList.remove('loading');
            pinStartFrame();
          };
          video.src = mediaUrl;
          if (hideFilm) mediaArea.classList.remove('loading');
          mediaArea.appendChild(video);
        } else {
          video.muted = true;
          video.autoplay = true;
          video.onloadeddata = () => mediaArea.classList.remove('loading');

          const replay = document.createElement('button');
          replay.type = 'button';
          replay.className = 'media-replay-btn';
          replay.hidden = true;
          replay.setAttribute('aria-label', t('replayMedia'));
          replay.title = t('replayMedia');
          replay.innerHTML = '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path fill="currentColor" d="M12 5V1L7 6l5 5V7c3.3 0 6 2.7 6 6s-2.7 6-6 6-6-2.7-6-6H4c0 4.4 3.6 8 8 8s8-3.6 8-8-3.6-8-8-8z"/></svg>';
          const setReplayVisible = (visible) => {
            replay.hidden = !visible;
            mediaArea.classList.toggle('is-replayable', visible);
          };
          replay.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            video.currentTime = 0;
            video.muted = false;
            setReplayVisible(false);
            video.play();
          });
          video.addEventListener('play', () => setReplayVisible(false));
          video.addEventListener('ended', () => setReplayVisible(true));

          mediaArea.classList.add('has-learn-video');
          video.src = mediaUrl;
          mediaArea.append(video, replay);
        }
      };
      loadVideo();
    } else if (q.mediaType === 'image') {
      const loadImage = () => {
        const mediaUrl = getNextMediaUrl();
        if (!mediaUrl) {
          showMediaFallback(() => {
            candidateIndex = 0;
            loadImage();
          });
          return;
        }

        mediaArea.classList.add('loading');
        mediaArea.innerHTML = '';

        const img = document.createElement('img');
        img.onload = () => mediaArea.classList.remove('loading');
        img.onerror = () => loadImage();
        img.src = mediaUrl;
        img.alt = t('imgAlt');
        img.loading = 'lazy';
        img.decoding = 'async';
        img.width = 1280;
        img.height = 720;
        if (examMedia) {
          img.draggable = false;
          img.tabIndex = -1;
          img.addEventListener('mousedown', (e) => e.preventDefault());
          img.addEventListener('click', (e) => e.preventDefault());
          img.addEventListener('contextmenu', (e) => e.preventDefault());
        }
        mediaArea.appendChild(img);
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
      mediaArea.innerHTML = '<svg class="media-empty-icon" viewBox="0 0 96 72" aria-hidden="true"><rect x="16" y="24" width="52" height="36" rx="6" fill="none" stroke="currentColor" stroke-width="3"/><rect x="24" y="14" width="18" height="12" rx="3" fill="none" stroke="currentColor" stroke-width="3"/><circle cx="42" cy="42" r="10" fill="none" stroke="currentColor" stroke-width="3"/><line x1="10" y1="10" x2="86" y2="62" stroke="currentColor" stroke-width="4" stroke-linecap="round"/></svg>';
    }
  }

  // Question text
  if (questionText) questionText.textContent = q.q;

  fillAnswerChoices(answersDiv, q);
  scheduleFitQuizDockText();
}

function fillAnswerChoices(answersDiv, q) {
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
      if (video.ended || video.currentTime > 0.05) video.currentTime = 0;
    } catch {}
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
    el.src = urls[i++];
  };
  el.addEventListener('error', tryUrl);
  tryUrl();
}

function appendReviewMedia(container, q) {
  if (!q.media) return;
  const wrap = document.createElement('div');
  wrap.className = 'review-media';
  const urls = getMediaUrls(q.media, q.mediaType);
  if (!urls.length) return;
  if (q.mediaType === 'video') {
    wrap.classList.add('has-review-video');
    const video = document.createElement('video');
    lockVideoChrome(video);
    video.preload = 'metadata';
    wrap.addEventListener('click', (e) => {
      if (e.target.closest('.media-replay-btn')) return;
      if (video.ended) video.currentTime = 0;
      if (video.paused || video.ended) video.play();
      else video.pause();
    });

    const PLAY_ICON = '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path fill="currentColor" d="M8 5v14l11-7z"/></svg>';
    const REPLAY_ICON = '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path fill="currentColor" d="M12 5V1L7 6l5 5V7c3.3 0 6 2.7 6 6s-2.7 6-6 6-6-2.7-6-6H4c0 4.4 3.6 8 8 8s8-3.6 8-8-3.6-8-8-8z"/></svg>';
    const replay = document.createElement('button');
    replay.type = 'button';
    replay.className = 'media-replay-btn';
    const setPlaybackControl = (mode) => {
      wrap.classList.toggle('is-replayable', Boolean(mode));
      replay.hidden = !mode;
      if (mode === 'replay') {
        replay.innerHTML = REPLAY_ICON;
        replay.setAttribute('aria-label', t('replayMedia'));
        replay.title = t('replayMedia');
      } else if (mode === 'play') {
        replay.innerHTML = PLAY_ICON;
        replay.setAttribute('aria-label', t('playMedia'));
        replay.title = t('playMedia');
      }
    };
    replay.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (video.ended) video.currentTime = 0;
      setPlaybackControl(null);
      video.play();
    });
    video.addEventListener('play', () => setPlaybackControl(null));
    video.addEventListener('pause', () => {
      if (!video.ended) setPlaybackControl('play');
    });
    video.addEventListener('ended', () => setPlaybackControl('replay'));
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

/** Preload the next question's media so it's ready when navigated to */
export function preloadMedia(question) {
  if (!question?.media) return;
  const urls = getMediaUrls(question.media, question.mediaType);
  if (!urls.length) return;
  if (question.mediaType === 'image') {
    const img = new Image();
    bindMediaFallback(img, urls);
  } else {
    const video = document.createElement('video');
    video.preload = 'metadata';
    video.muted = true;
    video.playsInline = true;
    bindMediaFallback(video, urls);
    video.load();
  }
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

  const rows = [];
  for (const cat of cats) {
    try {
      const data = await fetchCategory(cat.id);
      if (token !== _learnProgressRender) return;
      rows.push({ id: cat.id, ...getLearnCategoryBreakdown(cat.id, data.questions) });
    } catch {
      if (token !== _learnProgressRender) return;
    }
  }

  if (!rows.length) {
    emptyEl.style.display = '';
    if (introEl) introEl.style.display = 'none';
    if (clearBtn) clearBtn.style.display = 'none';
    return;
  }

  const totals = rows.reduce((acc, row) => ({
    known: acc.known + row.known,
    wrong: acc.wrong + row.wrong,
    learning: acc.learning + row.learning,
    neu: acc.neu + row.neu,
    answered: acc.answered + row.answered,
  }), { known: 0, wrong: 0, learning: 0, neu: 0, answered: 0 });

  if (summaryEl) {
    summaryEl.hidden = false;
    summaryEl.append(
      learnProgressChip(totals.known, t('learnProgressKnown')),
      learnProgressChip(totals.wrong, t('learnProgressWrong')),
      learnProgressChip(totals.learning, t('learnProgressLearning')),
      learnProgressChip(totals.neu, t('learnProgressNew')),
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
    line.textContent = `${row.known} ${t('learnProgressKnown')} · ${row.wrong} ${t('learnProgressWrong')} · ${row.learning} ${t('learnProgressLearning')} · ${row.neu} ${t('learnProgressNew')} · ${row.answered} ${t('learnProgressAnswered')}`;
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
  ensureCategorySearchUi();
  ensureQuizModeUi();
  document.dispatchEvent(new CustomEvent('prawko:language'));
}
